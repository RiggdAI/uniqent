import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { unpack, readDir, pack } from '@uniqent/core';
import type { Bundle } from '@uniqent/core';

const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/dist (built) or src (ts)

/** Dir holding pre-packed featured `.uniqent` files shipped with the package. */
function featuredDir(): string {
  return resolve(here, '..', 'featured');
}

/**
 * Load a featured brain's bundle. Prefers the pre-packed signed file shipped in the package;
 * falls back to packing the example source dir (used in tests / before build:featured runs).
 */
export async function loadFeaturedBundle(name: string): Promise<Bundle> {
  const packed = join(featuredDir(), `${name}.uniqent`);
  try {
    return unpack(new Uint8Array(await readFile(packed)));
  } catch {
    const src = resolve(here, '..', '..', '..', 'examples', name);
    return pack(await readDir(src)).then((bytes) => unpack(bytes));
  }
}
