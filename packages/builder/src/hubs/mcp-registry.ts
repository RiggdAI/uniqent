import { z } from 'zod';
import type { CredentialRequirement, McpServer } from '@uniqent/spec';
import { McpServer as McpServerSchema } from '@uniqent/spec';
import type { CatalogSource, McpHubResult, SkippedHubEntry, SourceResults } from './types.js';
import { slugifyId } from './types.js';
import { hubFetchJson, type FetchFn } from './http.js';
import { isSecretName, refSuffix } from '../mcp/normalize.js';

const ENDPOINT = 'https://registry.modelcontextprotocol.io/v0/servers';
const SOURCE = 'mcp-registry';

/*
 * The subset of the registry's server.json schema we read
 * (https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json).
 * Unknown fields are ignored; fields we rely on are validated per row.
 */
const RegistryInput = z.object({
  description: z.string().optional(),
  isRequired: z.boolean().optional(),
  isSecret: z.boolean().optional(),
  default: z.string().optional(),
  value: z.string().optional(),
});
const RegistryKeyValue = RegistryInput.extend({ name: z.string().min(1) });
const RegistryArgument = RegistryInput.extend({
  type: z.enum(['positional', 'named']),
  name: z.string().optional(),
  valueHint: z.string().optional(),
  format: z.string().optional(),
});
const RegistryRemote = z.object({
  type: z.string(),
  url: z.string(),
  headers: z.array(RegistryKeyValue).optional(),
});
const RegistryPackage = z.object({
  registryType: z.string(),
  identifier: z.string().min(1),
  version: z.string().optional(),
  runtimeHint: z.string().optional(),
  transport: z.object({ type: z.string() }),
  runtimeArguments: z.array(RegistryArgument).optional(),
  packageArguments: z.array(RegistryArgument).optional(),
  environmentVariables: z.array(RegistryKeyValue).optional(),
});
const RegistryServer = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  title: z.string().optional(),
  remotes: z.array(RegistryRemote).optional(),
  packages: z.array(RegistryPackage).optional(),
});
const RegistryRow = z.object({
  server: RegistryServer,
  _meta: z
    .object({
      'io.modelcontextprotocol.registry/official': z
        .object({ isLatest: z.boolean().optional() })
        .optional(),
    })
    .optional(),
});
/** Rows are validated one by one so a single malformed row is skipped, not fatal. */
const RegistryResponse = z.object({ servers: z.array(z.unknown()) });
const NamedRow = z.object({ server: z.object({ name: z.string() }) });

type RegistryRow = z.infer<typeof RegistryRow>;
type RegistryRemote = z.infer<typeof RegistryRemote>;
type RegistryPackage = z.infer<typeof RegistryPackage>;
type RegistryArgument = z.infer<typeof RegistryArgument>;

/** A mapping step either succeeds or says exactly why the entry can't be represented. */
type Mapped<T> = { ok: true; value: T } | { ok: false; reason: string };
const ok = <T>(value: T): Mapped<T> => ({ ok: true, value });
const fail = <T>(reason: string): Mapped<T> => ({ ok: false, reason });

interface ServerWithCreds {
  server: McpServer;
  credentials: CredentialRequirement[];
}

/** `{name}` placeholders the registry expects the client to fill in. */
const TEMPLATE_RE = /\{[^}]+\}/;
/** A header value that is just the credential: `{x}` (or VS Code-style `${x}`). */
const BARE_VAR_RE = /^\$?\{[^}]+\}$/;
/** An Authorization value that is a bearer credential: `Bearer {x}`. */
const BEARER_VAR_RE = /^Bearer \$?\{[^}]+\}$/i;

/** How each supported registry type is run. Anything else is skipped with a reason. */
const RUNTIME_BY_REGISTRY: Record<string, string> = { npm: 'npx', pypi: 'uvx', oci: 'docker' };

function isLatest(row: RegistryRow): boolean {
  const meta = row._meta?.['io.modelcontextprotocol.registry/official'];
  // Only filter out rows explicitly marked stale; treat unknown as latest.
  return meta?.isLatest !== false;
}

function credential(
  ref: string,
  label: string,
  type: CredentialRequirement['type'],
  id: string,
  required: boolean,
  help: string | undefined,
): CredentialRequirement {
  return {
    ref,
    label,
    type,
    consumedBy: [`mcp:${id}`],
    required,
    ...(help ? { help } : {}),
  };
}

function validated(
  server: McpServer,
  credentials: CredentialRequirement[],
): Mapped<ServerWithCreds> {
  const parsed = McpServerSchema.safeParse(server);
  if (!parsed.success) {
    return fail(`not a valid server declaration: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  }
  return ok({ server: parsed.data, credentials });
}

/** Map a remote: its (single) credential header becomes `auth` + a CredentialRequirement. */
function mapRemote(
  id: string,
  description: string,
  remote: RegistryRemote,
): Mapped<ServerWithCreds> {
  if (TEMPLATE_RE.test(remote.url)) {
    return fail(`remote URL ${remote.url} needs template variables filled in`);
  }
  if (remote.type !== 'streamable-http' && remote.type !== 'sse') {
    return fail(`remote transport "${remote.type}" is not supported`);
  }
  const headers = remote.headers ?? [];
  const isCredential = (h: z.infer<typeof RegistryKeyValue>) => h.isSecret || isSecretName(h.name);
  const plainRequired = headers.filter((h) => !isCredential(h) && h.isRequired);
  if (plainRequired.length > 0) {
    return fail(
      `requires non-credential header(s) ${plainRequired.map((h) => h.name).join(', ')}, which a server declaration cannot carry`,
    );
  }
  const credHeaders = headers.filter(isCredential);
  const requiredCreds = credHeaders.filter((h) => h.isRequired);
  if (requiredCreds.length > 1) {
    return fail(
      `requires ${requiredCreds.length} credential headers (${requiredCreds.map((h) => h.name).join(', ')}); only one is supported`,
    );
  }
  // Optional credential headers are alternatives (e.g. Authorization or X-API-Token): keep one.
  const header = requiredCreds[0] ?? credHeaders[0];
  const credentials: CredentialRequirement[] = [];
  let auth: McpServer['auth'] = { type: 'none' };
  if (header) {
    const required = header.isRequired === true;
    const label = header.description ?? header.name;
    if (/^authorization$/i.test(header.name)) {
      if (header.value !== undefined && !BEARER_VAR_RE.test(header.value)) {
        return fail(`Authorization value format "${header.value}" is not supported (only Bearer)`);
      }
      const ref = `${id}_token`;
      auth = { type: 'bearer', credentialRef: ref };
      credentials.push(credential(ref, label, 'apiKey', id, required, header.description));
    } else {
      if (header.value !== undefined && !BARE_VAR_RE.test(header.value)) {
        return fail(`header ${header.name} value format "${header.value}" is not supported`);
      }
      const ref = `${id}_${refSuffix(header.name)}`;
      auth = { type: 'header', headerName: header.name, credentialRef: ref };
      credentials.push(credential(ref, label, 'apiKey', id, required, header.description));
    }
  }
  return validated(
    {
      id,
      transport: remote.type,
      url: remote.url,
      auth,
      tools: { include: 'all' },
      description,
    },
    credentials,
  );
}

/** One registry argument → argv tokens (named: `--flag [value]`, positional: `value`). */
function argTokens(arg: RegistryArgument): Mapped<string[]> {
  const label = arg.name ?? arg.valueHint ?? arg.value ?? '(unnamed)';
  if (arg.isSecret)
    return fail(`argument ${label} is a secret; secret arguments are not supported`);
  const value = arg.value ?? arg.default;
  if (value !== undefined && TEMPLATE_RE.test(value)) {
    return fail(`argument ${label} needs template variables filled in ("${value}")`);
  }
  if (arg.type === 'named') {
    if (!arg.name) return fail('a named argument has no name');
    if (value === undefined) {
      // No value and no valueHint: a bare flag such as `--stdio` or `-i`.
      if (arg.valueHint === undefined) return ok([arg.name]);
      return arg.isRequired ? fail(`argument ${arg.name} requires a user-supplied value`) : ok([]);
    }
    if (arg.format === 'boolean') return ok(value === 'true' ? [arg.name] : []);
    return ok([arg.name, value]);
  }
  if (value === undefined) {
    return arg.isRequired
      ? fail(`positional argument ${label} requires a user-supplied value`)
      : ok([]);
  }
  return ok([value]);
}

function argv(args: RegistryArgument[]): Mapped<string[]> {
  const out: string[] = [];
  for (const arg of args) {
    const tokens = argTokens(arg);
    if (!tokens.ok) return tokens;
    out.push(...tokens.value);
  }
  return ok(out);
}

/** `image`, or `image:version` when the identifier carries no tag/digest of its own. */
function ociImage(pkg: RegistryPackage): string {
  const lastSegment = pkg.identifier.split('/').pop() ?? pkg.identifier;
  const tagged = lastSegment.includes(':') || pkg.identifier.includes('@');
  return tagged || !pkg.version ? pkg.identifier : `${pkg.identifier}:${pkg.version}`;
}

/** The pinned package spec for npx/uvx: `name@version`. */
function pinned(pkg: RegistryPackage): string {
  return pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier;
}

/**
 * Map a stdio package. Secret env vars → `${credentialRef:…}` + apiKey requirement; required
 * env vars with no value → envVar requirement; fixed/default values stay literal.
 */
function mapPackage(
  id: string,
  description: string,
  pkg: RegistryPackage,
): Mapped<ServerWithCreds> {
  const command = RUNTIME_BY_REGISTRY[pkg.registryType];
  if (!command) return fail(`package registry type "${pkg.registryType}" is not supported`);
  if (pkg.runtimeHint !== undefined && pkg.runtimeHint !== command) {
    return fail(`runtime "${pkg.runtimeHint}" for a ${pkg.registryType} package is not supported`);
  }
  if (pkg.transport.type !== 'stdio') {
    return fail(`package transport "${pkg.transport.type}" is not supported (stdio only)`);
  }
  const runtimeArgs = argv(pkg.runtimeArguments ?? []);
  if (!runtimeArgs.ok) return runtimeArgs;
  const packageArgs = argv(pkg.packageArguments ?? []);
  if (!packageArgs.ok) return packageArgs;

  const credentials: CredentialRequirement[] = [];
  const env: Record<string, string> = {};
  for (const v of pkg.environmentVariables ?? []) {
    const ref = `${id}_${refSuffix(v.name)}`;
    const label = v.description ?? v.name;
    if (v.isSecret || isSecretName(v.name)) {
      env[v.name] = `\${credentialRef:${ref}}`;
      credentials.push(credential(ref, label, 'apiKey', id, v.isRequired === true, v.description));
      continue;
    }
    const value = v.value ?? v.default;
    if (value !== undefined && TEMPLATE_RE.test(value)) {
      return fail(`env ${v.name} needs template variables filled in ("${value}")`);
    }
    if (value !== undefined) {
      env[v.name] = value;
    } else if (v.isRequired) {
      env[v.name] = `\${credentialRef:${ref}}`;
      credentials.push(credential(ref, label, 'envVar', id, true, v.description));
    }
  }

  let args: string[];
  if (pkg.registryType === 'oci') {
    // docker only forwards env vars named with -e into the container.
    const envFlags = Object.keys(env).flatMap((name) => ['-e', name]);
    args = [
      'run',
      '-i',
      '--rm',
      ...runtimeArgs.value,
      ...envFlags,
      ociImage(pkg),
      ...packageArgs.value,
    ];
  } else {
    // npx must not prompt to install on a non-interactive stdio launch.
    const yes = pkg.registryType === 'npm' && !runtimeArgs.value.includes('-y') ? ['-y'] : [];
    args = [...yes, ...runtimeArgs.value, pinned(pkg), ...packageArgs.value];
  }

  return validated(
    {
      id,
      transport: 'stdio',
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      auth: { type: 'none' },
      tools: { include: 'all' },
      description,
    },
    credentials,
  );
}

/**
 * Map one registry row to a hub result: the first remote or package that can be represented
 * wins; otherwise the row is skipped with every reason.
 */
export function mapRegistryServer(row: RegistryRow): Mapped<McpHubResult> {
  const s = row.server;
  const id = slugifyId(s.name);
  const description = s.description ?? '';
  const reasons: string[] = [];
  const candidates = [
    ...(s.remotes ?? []).map((r) => () => mapRemote(id, s.title ?? description, r)),
    ...(s.packages ?? []).map((p) => () => mapPackage(id, s.title ?? description, p)),
  ];
  if (candidates.length === 0) return fail('declares no remotes or packages');
  for (const candidate of candidates) {
    const mapped = candidate();
    if (!mapped.ok) {
      reasons.push(mapped.reason);
      continue;
    }
    const { server, credentials } = mapped.value;
    return ok({
      source: SOURCE,
      entry: {
        id,
        name: s.title ?? s.name,
        description,
        server,
        ...(credentials[0] ? { credential: credentials[0] } : {}),
      },
      credentials,
    });
  }
  return fail(reasons.join('; '));
}

/** Map a full registry response, dropping stale versions and reporting unusable rows. */
export function mapRegistryResponse(json: unknown): SourceResults<McpHubResult> {
  const parsed = RegistryResponse.safeParse(json);
  if (!parsed.success) {
    throw new Error(`MCP Registry: unexpected response shape: ${parsed.error.message}`);
  }
  const results: McpHubResult[] = [];
  const skipped: SkippedHubEntry[] = [];
  for (const raw of parsed.data.servers) {
    const row = RegistryRow.safeParse(raw);
    if (!row.success) {
      const named = NamedRow.safeParse(raw);
      skipped.push({
        source: SOURCE,
        name: named.success ? named.data.server.name : '(unnamed)',
        reason: `malformed registry entry: ${row.error.issues[0]?.path.join('.')} ${row.error.issues[0]?.message}`,
      });
      continue;
    }
    if (!isLatest(row.data)) continue;
    const mapped = mapRegistryServer(row.data);
    if (mapped.ok) results.push(mapped.value);
    else skipped.push({ source: SOURCE, name: row.data.server.name, reason: mapped.reason });
  }
  return { results, skipped };
}

export interface McpRegistryOptions {
  fetch: FetchFn;
  endpoint?: string;
  limit?: number;
}

/** The official Model Context Protocol registry (latest version of each server). No auth. */
export function mcpRegistrySource(opts: McpRegistryOptions): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  const limit = opts.limit ?? 30;
  return {
    id: SOURCE,
    label: 'MCP Registry',
    async searchMcp(query: string, signal?: AbortSignal): Promise<SourceResults<McpHubResult>> {
      const url = `${endpoint}?search=${encodeURIComponent(query)}&version=latest&limit=${limit}`;
      return mapRegistryResponse(await hubFetchJson(opts.fetch, 'MCP Registry', url, {}, signal));
    },
  };
}
