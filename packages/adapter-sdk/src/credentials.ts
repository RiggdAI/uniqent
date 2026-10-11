import type { Bundle } from '@uniqent/core';

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

/**
 * Assert every credential ref an MCP server uses (`refs`, as the adapter wires them) is declared
 * in the manifest with `consumedBy` listing `mcp:<serverId>`; throws `CredentialScopeError` otherwise.
 */
export function assertMcpCredentialScope(bundle: Bundle, serverId: string, refs: string[]): void {
  const consumer = `mcp:${serverId}`;
  const credentials = bundle.manifest().credentials;
  for (const ref of refs)
    if (!credentials.some((c) => c.ref === ref && c.consumedBy.includes(consumer)))
      throw new CredentialScopeError(serverId, ref);
}
