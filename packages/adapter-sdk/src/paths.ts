import { isAbsolute, relative, resolve } from 'node:path';
import type { Bundle } from '@uniqent/core';

/** A bundle-derived path would resolve outside the install root. */
export class PathEscapeError extends Error {
  constructor(
    readonly root: string,
    readonly path: string,
  ) {
    super(`refusing to write "${path}": it resolves outside the install root "${root}"`);
    this.name = 'PathEscapeError';
  }
}

/**
 * Resolve a relative, bundle-derived `path` against `root` and assert it stays inside it.
 * Every adapter write goes through this so a hostile bundle can never escape `--root`.
 */
export function resolveInside(root: string, path: string): string {
  const base = resolve(root);
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new PathEscapeError(root, path);
  return target;
}

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
