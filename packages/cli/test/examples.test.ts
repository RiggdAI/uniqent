import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readDir, validateBundle, pack } from '@uniqent/core';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '../../../examples');

describe('example bundles', () => {
  for (const name of ['dev-powerpack', 'research-analyst', 'personal-assistant', 'garry-stack']) {
    it(`${name} validates and packs (no secrets)`, async () => {
      const bundle = await readDir(resolve(examplesDir, name));
      expect(validateBundle(bundle).ok).toBe(true);
      const bytes = await pack(bundle); // throws if the secret-scan trips
      expect(bytes.length).toBeGreaterThan(0);
    });
  }
});
