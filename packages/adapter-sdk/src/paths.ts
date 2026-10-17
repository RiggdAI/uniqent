import { isAbsolute, relative, resolve } from 'node:path';
import { PathEscapeError } from './pure-paths.js';

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
