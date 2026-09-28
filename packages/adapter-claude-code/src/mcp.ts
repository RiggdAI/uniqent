import type { McpServer } from '@uniqent/spec';
import { resolvePlaceholders } from '@uniqent/core';
import type { Bundle } from '@uniqent/core';
import type { ResolvedCredentials } from '@uniqent/adapter-sdk';

const CREDENTIAL_REF_RE = /\$\{credentialRef:([^}]+)\}/g;

/** An existing `.mcp.json` could not be parsed or has an unexpected shape; we never overwrite it blindly. */
export class McpConfigParseError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
  ) {
    super(`cannot merge into ${file}: ${reason}. Fix or remove the file, then re-run the install.`);
    this.name = 'McpConfigParseError';
  }
}

/** An MCP server references a credential whose manifest `consumedBy` does not list that server. */
export class CredentialScopeError extends Error {
  constructor(
    readonly serverId: string,
    readonly ref: string,
  ) {
    super(
      `mcp server "${serverId}" references credential "${ref}", but the manifest does not declare ` +
        `it as consumedBy "mcp:${serverId}"; refusing to inject a credential into a server it was not granted to`,
    );
    this.name = 'CredentialScopeError';
  }
}

/** A parsed `.mcp.json`: its top-level document (other keys preserved) and its server entries. */
export interface McpJsonFile {
  doc: Record<string, unknown>;
  servers: Record<string, Record<string, unknown>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse an existing `.mcp.json`, throwing `McpConfigParseError` instead of discarding it. */
export function parseMcpJson(file: string, text: string): McpJsonFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new McpConfigParseError(file, `invalid JSON (${(err as Error).message})`);
  }
  if (!isRecord(doc)) throw new McpConfigParseError(file, 'top level is not a JSON object');
  const raw = doc.mcpServers ?? {};
  if (!isRecord(raw)) throw new McpConfigParseError(file, '"mcpServers" is not an object');
  const servers: Record<string, Record<string, unknown>> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isRecord(entry))
      throw new McpConfigParseError(file, `"mcpServers.${id}" is not an object`);
    servers[id] = entry;
  }
  return { doc, servers };
}

/** Every credential ref a server uses: its auth ref plus `${credentialRef:…}` placeholders in env. */
function serverCredentialRefs(server: McpServer): string[] {
  const refs = new Set<string>();
  if (server.auth.credentialRef) refs.add(server.auth.credentialRef);
  for (const v of Object.values(server.env ?? {})) {
    for (const m of v.matchAll(CREDENTIAL_REF_RE)) if (m[1]) refs.add(m[1]);
  }
  return [...refs];
}

/**
 * The subset of `resolved` a server may receive: only refs whose manifest `consumedBy` lists
 * `mcp:<id>`. Throws `CredentialScopeError` when the server references a ref it was not granted.
 */
export function scopedCredentials(
  bundle: Bundle,
  server: McpServer,
  resolved: ResolvedCredentials,
): ResolvedCredentials {
  const consumer = `mcp:${server.id}`;
  const credentials = bundle.manifest().credentials;
  const scoped: ResolvedCredentials = {};
  for (const ref of serverCredentialRefs(server)) {
    const granted = credentials.some((c) => c.ref === ref && c.consumedBy.includes(consumer));
    if (!granted) throw new CredentialScopeError(server.id, ref);
    const value = resolved[ref];
    if (value !== undefined) scoped[ref] = value;
  }
  return scoped;
}

/** Placeholder credentials (each ref mapped to its own name) so an entry's shape can be computed pre-resolution. */
export function placeholderCredentials(server: McpServer): ResolvedCredentials {
  return Object.fromEntries(serverCredentialRefs(server).map((r) => [r, r]));
}

/**
 * Credential-free identity of a `.mcp.json` entry — what it runs or connects to. env/header
 * VALUES are ignored (they hold resolved secrets); only their keys count.
 */
export function mcpEntryShape(entry: Record<string, unknown>): string {
  const keys = (v: unknown): string[] => (isRecord(v) ? Object.keys(v).sort() : []);
  return JSON.stringify({
    type: entry.type ?? null,
    command: entry.command ?? null,
    args: entry.args ?? null,
    url: entry.url ?? null,
    env: keys(entry.env),
    headers: keys(entry.headers),
  });
}

/** Translate a canonical MCP server into a Claude Code `.mcp.json` server entry. */
export function toClaudeMcpEntry(
  server: McpServer,
  resolved: ResolvedCredentials,
): Record<string, unknown> {
  if (server.transport === 'stdio') {
    const entry: Record<string, unknown> = { command: server.command };
    if (server.args) entry.args = server.args;
    if (server.env) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(server.env)) env[k] = resolvePlaceholders(v, resolved);
      entry.env = env;
    }
    return entry;
  }

  const entry: Record<string, unknown> = {
    type: server.transport === 'sse' ? 'sse' : 'http',
    url: server.url,
  };
  const headers: Record<string, string> = {};
  const { auth } = server;
  const value = auth.credentialRef ? resolved[auth.credentialRef] : undefined;
  if (value) {
    if (auth.type === 'bearer') headers.Authorization = `Bearer ${value}`;
    else if (auth.type === 'header' && auth.headerName) headers[auth.headerName] = value;
  }
  if (Object.keys(headers).length > 0) entry.headers = headers;
  return entry;
}
