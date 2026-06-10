import type { McpServer, CredentialRequirement } from '@uniqent/spec';
import { McpServer as McpServerSchema } from '@uniqent/spec';
import { isLikelySecretValue } from '@uniqent/core';
import { slugifyId } from '../hubs/types.js';

export interface NormalizeResult {
  servers: McpServer[];
  credentials: CredentialRequirement[];
  lossiness: string[];
}

const SECRET_NAME_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PAT|AUTH|APIKEY|ACCESS|CREDENTIAL)/i;
const isSecretName = (name: string): boolean => SECRET_NAME_RE.test(name);

/** A single raw server entry as found in the wild (mcpServers map value or a bare object). */
interface RawServer {
  id?: string;
  transport?: string;
  url?: string;
  command?: string;
  args?: unknown;
  env?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  auth?: unknown;
  tools?: unknown;
  description?: string;
}

/** A stable credential-ref suffix from an env/header name. */
function refSuffix(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function credFor(ref: string, label: string, id: string): CredentialRequirement {
  return { ref, label, type: 'apiKey', consumedBy: [`mcp:${id}`], required: true };
}

function pushValidated(server: unknown, creds: CredentialRequirement[], out: NormalizeResult): void {
  const parsed = McpServerSchema.safeParse(server);
  if (!parsed.success) {
    out.lossiness.push(`skipped a server: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return;
  }
  out.servers.push(parsed.data);
  out.credentials.push(...creds);
}

/** Convert one raw server to canonical + its lifted credentials. */
function mapOne(id: string, raw: RawServer, out: NormalizeResult): void {
  const creds: CredentialRequirement[] = [];
  const description = typeof raw.description === 'string' ? raw.description : undefined;
  const isRemote = !!raw.url && !raw.command;

  if (isRemote) {
    const transport =
      /sse(\b|$|\/)/.test(raw.url!) || raw.transport === 'sse' ? 'sse' : 'streamable-http';
    let auth: McpServer['auth'] = { type: 'none' };
    const headers = (raw.headers ?? {}) as Record<string, unknown>;
    const secretHeaders = Object.entries(headers).filter(
      ([k, v]) => typeof v === 'string' && (isSecretName(k) || isLikelySecretValue(v)),
    );
    if (secretHeaders.length > 0) {
      const hName = secretHeaders[0]![0];
      if (/^authorization$/i.test(hName)) {
        const ref = `${id}_token`;
        auth = { type: 'bearer', credentialRef: ref };
        creds.push(credFor(ref, hName, id));
      } else {
        const ref = `${id}_${refSuffix(hName)}`;
        auth = { type: 'header', headerName: hName, credentialRef: ref };
        creds.push(credFor(ref, hName, id));
      }
      if (secretHeaders.length > 1) {
        out.lossiness.push(
          `${id}: only the first auth header is kept; dropped ${secretHeaders
            .slice(1)
            .map(([k]) => k)
            .join(', ')}`,
        );
      }
    }
    const server = {
      id,
      transport,
      url: raw.url,
      auth,
      tools: { include: 'all' as const },
      ...(description ? { description } : {}),
    };
    pushValidated(server, creds, out);
    return;
  }

  // stdio
  const args = Array.isArray(raw.args)
    ? raw.args.filter((a): a is string => typeof a === 'string')
    : [];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.env ?? {})) {
    if (typeof v !== 'string') continue;
    if (isSecretName(k) || isLikelySecretValue(v)) {
      const ref = `${id}_${refSuffix(k)}`;
      env[k] = `\${credentialRef:${ref}}`;
      creds.push(credFor(ref, k, id));
    } else {
      env[k] = v;
    }
  }
  const server = {
    id,
    transport: 'stdio',
    command: raw.command ?? 'npx',
    ...(args.length ? { args } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    auth: { type: 'none' as const },
    tools: { include: 'all' as const },
    ...(description ? { description } : {}),
  };
  pushValidated(server, creds, out);
}

/**
 * Normalize any common MCP config shape to canonical servers + lifted credentials.
 * Accepts: a `{ mcpServers: { name: {...} } }` blob, a single raw/canonical server object,
 * or a `{ servers: [...] }` list. Never throws — unknown shapes return a lossiness note.
 *
 * Every secret env var / auth header value is replaced with a `${credentialRef:…}` placeholder
 * and emitted as a `CredentialRequirement`, so the result always passes the fail-closed secret gate.
 */
export function normalizeMcpConfig(input: unknown): NormalizeResult {
  const out: NormalizeResult = { servers: [], credentials: [], lossiness: [] };
  if (!input || typeof input !== 'object') {
    out.lossiness.push('unrecognized MCP config format');
    return out;
  }
  const obj = input as Record<string, unknown>;

  // Already-canonical (or near) single server: has id + transport.
  if (typeof obj.id === 'string' && typeof obj.transport === 'string') {
    const canonical = McpServerSchema.safeParse({ tools: { include: 'all' }, ...obj });
    if (canonical.success) {
      out.servers.push(canonical.data);
      return out;
    }
  }

  if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    for (const [name, raw] of Object.entries(obj.mcpServers as Record<string, RawServer>)) {
      mapOne(slugifyId(name), raw ?? {}, out);
    }
    return out;
  }
  if (Array.isArray(obj.servers)) {
    for (const raw of obj.servers as RawServer[]) {
      const id = typeof raw.id === 'string' && raw.id ? slugifyId(raw.id) : 'mcp-server';
      mapOne(id, raw, out);
    }
    return out;
  }
  // A bare single raw server (command or url present).
  if (typeof obj.command === 'string' || typeof obj.url === 'string') {
    const id = typeof obj.id === 'string' && obj.id ? slugifyId(obj.id) : 'mcp-server';
    mapOne(id, obj as RawServer, out);
    return out;
  }

  out.lossiness.push('unrecognized MCP config format');
  return out;
}
