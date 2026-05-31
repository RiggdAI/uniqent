import type { McpServer } from '@uniqent/spec';
import { resolvePlaceholders } from '@uniqent/core';
import type { ResolvedCredentials } from '@uniqent/adapter-sdk';

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
