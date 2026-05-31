import { createHash } from 'node:crypto';
import { Bundle, PATHS } from './bundle.js';

/**
 * Deterministic content digest over preserved file bytes, excluding signature.json.
 * Independent of archive format and insertion order, so unpack(pack(b)) reproduces it.
 */
export function canonicalDigest(bundle: Bundle): string {
  const entries = bundle
    .entries()
    .filter(([path]) => path !== PATHS.signature)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let canonical = '';
  for (const [path, bytes] of entries) {
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    canonical += `${path}\n${fileHash}\n`;
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
