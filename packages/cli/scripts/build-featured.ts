import { readDir, pack, sign, generateKeypair } from '@uniqent/core';
import { featuredBrains } from '@uniqent/builder';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/scripts
const examplesDir = resolve(here, '../../../examples');
const outDir = resolve(here, '../featured');

const kp = await generateKeypair();
await mkdir(outDir, { recursive: true });

for (const b of featuredBrains()) {
  const bundle = await readDir(join(examplesDir, b.name));
  const signed = await sign(bundle, kp.privateKey); // runs the secret-scan gate
  const bytes = await pack(signed);
  await writeFile(join(outDir, `${b.name}.uniqent`), bytes);
  console.log(`featured: ${b.name}.uniqent (${bytes.length} bytes)`);
}
