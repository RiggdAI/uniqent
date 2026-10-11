import type { Bundle } from '@uniqent/core/pure';

/**
 * Credential refs a target must resolve: every manifest credential consumed by a component
 * of one of `consumerKinds` (e.g. `mcp`, `channel`). Uses the manifest's `consumedBy`, so refs
 * used anywhere in a server (auth, stdio `env`, headers) are covered, not just `auth.credentialRef`.
 */
export function requiredCredentialRefs(bundle: Bundle, consumerKinds: string[]): string[] {
  const prefixes = consumerKinds.map((k) => `${k}:`);
  return bundle
    .manifest()
    .credentials.filter((c) => c.consumedBy.some((x) => prefixes.some((p) => x.startsWith(p))))
    .map((c) => c.ref);
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

/** Env vars an MCP field may reference with `${NAME}`: non-secret, expanded by every target. */
const ALLOWED_ENV_REFERENCES: ReadonlySet<string> = new Set(['HOME']);
const ENV_REFERENCE_RE = /\$\{([^}]*)\}/g;

/**
 * An MCP field holds a `${…}` env reference that is neither a `${credentialRef:…}` placeholder nor
 * allowlisted. Every target expands `${VAR}` from the user's environment, so a bundle could read
 * (and send off) a secret the user never granted it.
 */
export class EnvReferenceError extends Error {
  constructor(
    readonly serverId: string,
    readonly field: string,
    readonly reference: string,
  ) {
    super(
      `mcp server "${serverId}" ${field} references the environment variable "${reference}"; ` +
        `bundles may only use \${credentialRef:<ref>} (declared in the manifest) or ` +
        `${[...ALLOWED_ENV_REFERENCES].map((n) => `\${${n}}`).join(', ')}`,
    );
    this.name = 'EnvReferenceError';
  }
}

/**
 * Assert no MCP server field a target writes (url, command, args, env values, auth header name)
 * references an environment variable other than an allowlisted one; throws `EnvReferenceError`.
 */
export function assertNoEnvReferences(bundle: Bundle): void {
  for (const s of bundle.mcpServers()) {
    const fields: Array<[string, string | undefined]> = [
      ['url', s.url],
      ['command', s.command],
      ['auth.headerName', s.auth.headerName],
      ...(s.args ?? []).map((a, i): [string, string] => [`args[${i}]`, a]),
      ...Object.entries(s.env ?? {}).map(([k, v]): [string, string] => [`env.${k}`, v]),
    ];
    for (const [field, value] of fields)
      for (const [, name = ''] of (value ?? '').matchAll(ENV_REFERENCE_RE))
        if (!name.startsWith('credentialRef:') && !ALLOWED_ENV_REFERENCES.has(name))
          throw new EnvReferenceError(s.id, field, name);
  }
}
