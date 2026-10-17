import type { McpServer, CredentialRequirement } from '@uniqent/spec';
import { McpServer as McpServerSchema } from '@uniqent/spec';
import { isLikelySecretValue } from '@uniqent/core/pure';
import { slugifyId } from '../hubs/types.js';

export interface NormalizeResult {
  servers: McpServer[];
  credentials: CredentialRequirement[];
  lossiness: string[];
}

/**
 * Final name words that mark a credential. Env/header names put the noun last (GITHUB_TOKEN,
 * X-API-Key, DB_PASSWORD), so matching whole trailing words avoids false hits on PATH,
 * AUTHOR_NAME, MEMORY_FILE_PATH, TOKEN_URL, or KEY_PATH. Secret-looking values are caught
 * separately by isLikelySecretValue.
 */
const SECRET_NAME_WORDS = new Set([
  'key',
  'apikey',
  'token',
  'secret',
  'password',
  'passwd',
  'pwd',
  'pass',
  'pat',
  'auth',
  'authorization',
  'authentication',
  'credential',
  'credentials',
]);

/** Whether an env var / header name denotes a credential (judged by its last word). */
export function isSecretName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
  const last = words[words.length - 1];
  return last !== undefined && SECRET_NAME_WORDS.has(last);
}

const CREDENTIAL_REF_RE = /^\$\{credentialRef:[^}]+\}$/;

/** A single raw server entry as found in the wild (mcpServers map value or a bare object). */
interface RawServer {
  id?: string;
  transport?: string;
  /** VS Code mcp.json spelling of the transport ("stdio" | "http" | "sse"). */
  type?: string;
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
export function refSuffix(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function credFor(ref: string, label: string, id: string): CredentialRequirement {
  return { ref, label, type: 'apiKey', consumedBy: [`mcp:${id}`], required: true };
}

/**
 * Replace every secret env value (by name or by value) with a `${credentialRef:…}` placeholder and
 * record its requirement. Values that already are placeholders are kept as-is.
 */
function liftEnv(
  id: string,
  rawEnv: Record<string, unknown>,
  creds: CredentialRequirement[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawEnv)) {
    if (typeof v !== 'string') continue;
    if (CREDENTIAL_REF_RE.test(v)) {
      env[k] = v;
    } else if (isSecretName(k) || isLikelySecretValue(v)) {
      const ref = `${id}_${refSuffix(k)}`;
      env[k] = `\${credentialRef:${ref}}`;
      creds.push(credFor(ref, k, id));
    } else {
      env[k] = v;
    }
  }
  return env;
}

function pushValidated(
  server: unknown,
  creds: CredentialRequirement[],
  out: NormalizeResult,
): void {
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
    // `transport` is ours/Claude's; VS Code's mcp.json names it `type` ("http" | "sse").
    const transport =
      /sse(\b|$|\/)/.test(raw.url!) || raw.transport === 'sse' || raw.type === 'sse'
        ? 'sse'
        : 'streamable-http';
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
  if (typeof raw.command !== 'string' || !raw.command) {
    out.lossiness.push(`skipped server "${id}": it has neither a command nor a url`);
    return;
  }
  const args = Array.isArray(raw.args)
    ? raw.args.filter((a): a is string => typeof a === 'string')
    : [];
  const env = liftEnv(id, raw.env ?? {}, creds);
  const server = {
    id,
    transport: 'stdio',
    command: raw.command,
    ...(args.length ? { args } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    auth: { type: 'none' as const },
    tools: { include: 'all' as const },
    ...(description ? { description } : {}),
  };
  pushValidated(server, creds, out);
}

/** `base`, or `base-2`, `base-3`, … — the first id not yet taken (then marks it taken). */
function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

/**
 * Normalize any common MCP config shape to canonical servers + lifted credentials.
 * Accepts: a `{ mcpServers: { name: {...} } }` blob (Claude/Cursor), a VS Code
 * `{ servers: { name: {...} } }` map, a `{ servers: [...] }` list, or a single raw/canonical
 * server object. Server ids are made unique (`-2`, `-3`, … on collision). Never throws — unknown
 * shapes return a lossiness note.
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

  // Already-canonical (or near) single server: has id + transport. Secrets are still lifted.
  if (typeof obj.id === 'string' && typeof obj.transport === 'string') {
    const canonical = McpServerSchema.safeParse({ tools: { include: 'all' }, ...obj });
    if (canonical.success) {
      const creds: CredentialRequirement[] = [];
      const { env: rawEnv, ...rest } = canonical.data;
      const env = rawEnv ? liftEnv(rest.id, rawEnv, creds) : undefined;
      pushValidated({ ...rest, ...(env ? { env } : {}) }, creds, out);
      return out;
    }
  }

  const taken = new Set<string>();
  // Claude/Cursor `mcpServers` map, or VS Code's `servers` map (same per-server shape).
  const serverMap = obj.mcpServers ?? (Array.isArray(obj.servers) ? undefined : obj.servers);
  if (serverMap && typeof serverMap === 'object') {
    for (const [name, raw] of Object.entries(serverMap as Record<string, RawServer>)) {
      mapOne(uniqueId(slugifyId(name), taken), raw ?? {}, out);
    }
    return out;
  }
  if (Array.isArray(obj.servers)) {
    for (const raw of obj.servers as RawServer[]) {
      const base = typeof raw?.id === 'string' && raw.id ? slugifyId(raw.id) : 'mcp-server';
      mapOne(uniqueId(base, taken), raw ?? {}, out);
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
