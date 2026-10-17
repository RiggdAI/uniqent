import type { CredentialRequirement, McpServer } from '@uniqent/spec';
import { envName } from './env.js';
import { HermesConfigError } from './config.js';

const CREDENTIAL_REF_RE = /\$\{credentialRef:([^}]+)\}/g;
/** A `${VAR}` / `${env:VAR}` reference Hermes interpolates from .env (tools/mcp_tool.py). */
const ENV_REF_RE = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)\}/;
const EXACT_ENV_REF_RE = new RegExp(`^${ENV_REF_RE.source}$`);

/** One `mcp_servers.<name>` entry in Hermes' config.yaml (tools/mcp_tool.py _load_mcp_config). */
export interface HermesMcpEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'sse';
  headers?: Record<string, string>;
  auth?: 'oauth';
  tools?: { include: string[] };
}

/** The auth header Hermes sends for an http/sse server (`Authorization: Bearer …` or a named header). */
function authHeader(server: McpServer): Record<string, string> | undefined {
  const ref = server.auth.credentialRef;
  if (server.transport === 'stdio' || ref === undefined) return undefined;
  if (server.auth.type === 'bearer') return { Authorization: `Bearer \${${envName(ref)}}` };
  if (server.auth.type === 'header' && server.auth.headerName)
    return { [server.auth.headerName]: `\${${envName(ref)}}` };
  return undefined;
}

/**
 * Credential refs the Hermes entry actually uses: the auth ref when it becomes an auth header,
 * plus every `${credentialRef:…}` placeholder in command/args/env/url.
 */
export function mcpCredentialRefs(server: McpServer): string[] {
  const refs = new Set<string>();
  if (authHeader(server) !== undefined && server.auth.credentialRef)
    refs.add(server.auth.credentialRef);
  const strings = [
    ...(server.command === undefined ? [] : [server.command]),
    ...(server.url === undefined ? [] : [server.url]),
    ...(server.args ?? []),
    ...Object.values(server.env ?? {}),
  ];
  for (const s of strings) for (const m of s.matchAll(CREDENTIAL_REF_RE)) if (m[1]) refs.add(m[1]);
  return [...refs];
}

/** Why a server's `auth` cannot be carried into Hermes, if it cannot. */
export function unmappedAuth(server: McpServer): string | undefined {
  const ref = server.auth.credentialRef;
  if (ref === undefined || authHeader(server) !== undefined) return undefined;
  if (server.auth.type === 'oauth2')
    return `auth.credentialRef "${ref}" not installed: Hermes runs its own OAuth flow (auth: oauth).`;
  return `auth.credentialRef "${ref}" (${server.auth.type}) not installed: Hermes ${server.transport} servers take credentials only through env/url \${VAR} refs.`;
}

/** Rewrite `${credentialRef:x}` placeholders into the `${X}` env refs Hermes interpolates. */
const toEnvRefs = (value: string): string =>
  value.replace(CREDENTIAL_REF_RE, (_whole, ref: string) => `\${${envName(ref)}}`);

/** Translate a canonical MCP server into Hermes' config.yaml form; secrets stay `${ENV}` refs. */
export function toHermesMcp(server: McpServer): HermesMcpEntry {
  const entry: HermesMcpEntry = {};
  if (server.transport === 'stdio') {
    if (server.command === undefined)
      throw new HermesConfigError(`mcp server "${server.id}": stdio transport has no command`);
    entry.command = toEnvRefs(server.command);
    if (server.args) entry.args = server.args.map(toEnvRefs);
    if (server.env)
      entry.env = Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, toEnvRefs(v)]));
  } else {
    if (server.url === undefined)
      throw new HermesConfigError(`mcp server "${server.id}": ${server.transport} has no url`);
    entry.url = toEnvRefs(server.url);
    if (server.transport === 'sse') entry.transport = 'sse';
    const headers = authHeader(server);
    if (headers !== undefined) entry.headers = headers;
    if (server.auth.type === 'oauth2') entry.auth = 'oauth';
  }
  if (Array.isArray(server.tools.include)) entry.tools = { include: [...server.tools.include] };
  return entry;
}

function expectRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new HermesConfigError(`${where} must be a mapping`);
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, where: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HermesConfigError(`${where} must be a string`);
  return value;
}

function optionalStrings(value: unknown, where: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))
    throw new HermesConfigError(`${where} must be a list of strings`);
  return value as string[];
}

function optionalStringRecord(value: unknown, where: string): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  const record = expectRecord(value, where);
  for (const [k, v] of Object.entries(record))
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
      throw new HermesConfigError(`${where}.${k} must be a scalar`);
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, String(v)]));
}

const refFromVar = (name: string): string => name.toLowerCase();

function tokenRefFor(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${slug || 'mcp'}_token`;
}

/** A captured MCP server plus the credential requirements (never values) it needs. */
export interface CapturedMcp {
  server: McpServer;
  credentials: CredentialRequirement[];
}

/**
 * Reverse one config.yaml `mcp_servers` entry into a canonical server. Values are never copied:
 * every stdio env value and auth header becomes a credential requirement, named after the
 * `${VAR}` it referenced (e.g. `${GITHUB_PAT}` → `github_pat`) or else after the key/server.
 */
export function fromHermesMcp(id: string, raw: unknown): CapturedMcp {
  const where = `mcp_servers.${id}`;
  const cfg = expectRecord(raw, where);
  const tools =
    cfg.tools === undefined || cfg.tools === null ? {} : expectRecord(cfg.tools, `${where}.tools`);
  const include = optionalStrings(tools.include, `${where}.tools.include`);
  const credentials: CredentialRequirement[] = [];
  const requirement = (ref: string, label: string, type: CredentialRequirement['type']) =>
    credentials.push({
      ref,
      label,
      type,
      consumedBy: [`mcp:${id}`],
      required: true,
      help: 'Re-supplied locally at install; captured from Hermes config.yaml without its value.',
    });
  const base = { id, tools: { include: include ?? ('all' as const) } };

  const command = optionalString(cfg.command, `${where}.command`);
  if (command !== undefined) {
    const env = optionalStringRecord(cfg.env, `${where}.env`);
    const capturedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(env ?? {})) {
      const ref = refFromVar(EXACT_ENV_REF_RE.exec(value)?.[1] ?? key);
      capturedEnv[key] = `\${credentialRef:${ref}}`;
      requirement(ref, `${key} for MCP server ${id}`, 'envVar');
    }
    const args = optionalStrings(cfg.args, `${where}.args`);
    return {
      server: {
        ...base,
        transport: 'stdio',
        command,
        ...(args === undefined ? {} : { args }),
        ...(env === undefined ? {} : { env: capturedEnv }),
        auth: { type: 'none' },
      },
      credentials,
    };
  }

  const url = optionalString(cfg.url, `${where}.url`);
  if (url === undefined) throw new HermesConfigError(`${where} has neither command nor url`);
  const transport =
    optionalString(cfg.transport, `${where}.transport`) === 'sse' ? 'sse' : 'streamable-http';
  const headers = Object.entries(optionalStringRecord(cfg.headers, `${where}.headers`) ?? {});
  const bearer = headers.find(
    ([h, v]) => h.toLowerCase() === 'authorization' && /^Bearer\s/i.test(v),
  );
  const other = headers.find((h) => h !== bearer);
  const refIn = (value: string): string => {
    const name = ENV_REF_RE.exec(value)?.[1];
    return name === undefined ? tokenRefFor(id) : refFromVar(name);
  };
  let auth: McpServer['auth'] = { type: 'none' };
  if (optionalString(cfg.auth, `${where}.auth`)?.toLowerCase() === 'oauth') {
    auth = { type: 'oauth2' };
  } else if (bearer !== undefined) {
    const ref = refIn(bearer[1]);
    auth = { type: 'bearer', credentialRef: ref };
    requirement(ref, `${id} bearer token`, 'bearer');
  } else if (other !== undefined) {
    const ref = refIn(other[1]);
    auth = { type: 'header', headerName: other[0], credentialRef: ref };
    requirement(ref, `${id} ${other[0]} header`, 'header');
  }
  return { server: { ...base, transport, url, auth }, credentials };
}
