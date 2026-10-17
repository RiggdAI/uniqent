import type { FileRef } from './io.js';

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
 * Normalize a relative POSIX path ('.'/'..' folded); PathEscapeError if absolute, contains '\\'
 * or NUL, is empty, or climbs out of `base`. Every bundle-derived write path goes through this
 * so a hostile bundle can never escape the install root.
 */
export function confineRelative(base: string, path: string): string {
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0'))
    throw new PathEscapeError(base, path);
  const stack: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg !== '..') stack.push(seg);
    else if (stack.length === 0) throw new PathEscapeError(base, path);
    else stack.pop();
  }
  if (stack.length === 0) throw new PathEscapeError(base, path);
  return stack.join('/');
}

/** `dir/rel`, with any trailing `/` trimmed from `dir`. */
export function joinPath(dir: string, rel: string): string {
  return `${dir.replace(/\/+$/, '')}/${rel}`;
}

/** POSIX `resolve(base, p)` for configured directories (OpenClaw workspace); `base` must be absolute. */
export function resolvePosix(base: string, p: string): string {
  const full = p.startsWith('/') ? p : `${base}/${p}`;
  if (!full.startsWith('/'))
    throw new Error(`cannot resolve "${p}" against "${base}": the base is not an absolute path`);
  // Like Node's resolve, `..` at the filesystem root stays at the root.
  const stack: string[] = [];
  for (const seg of full.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return `/${stack.join('/')}`;
}

/** Root-relative path when the write lies under `root`, else the absolute path (what the CLI prints today). */
export function displayPath(root: string, ref: FileRef): string {
  const base = resolvePosix(root, '.');
  const abs = resolvePosix(ref.root, ref.path);
  const prefix = base === '/' ? '/' : `${base}/`;
  if (abs !== base && !abs.startsWith(prefix)) return abs;
  const rel = abs.slice(prefix.length);
  return rel.startsWith('..') ? abs : rel;
}
