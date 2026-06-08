import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readDir, validateBundle, pack } from '@uniqent/core';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '../../../examples');

describe('example bundles', () => {
  for (const name of ['dev-powerpack', 'research-analyst', 'personal-assistant']) {
    it(`${name} validates and packs (no secrets)`, async () => {
      const bundle = await readDir(resolve(examplesDir, name));
      expect(validateBundle(bundle).ok).toBe(true);
      const bytes = await pack(bundle); // throws if the secret-scan trips
      expect(bytes.length).toBeGreaterThan(0);
    });
  }

  it('research-analyst is a rich hero: ≥10 facts, creds-free, has suggestedPrompts', async () => {
    const bundle = await readDir(resolve(examplesDir, 'research-analyst'));
    const m = JSON.parse(new TextDecoder().decode(bundle.get('uniqent.json')!));
    expect(m.components.memory.facts).toBeGreaterThanOrEqual(10);
    expect(m.credentials).toEqual([]);
    expect(Array.isArray(m.suggestedPrompts)).toBe(true);
    expect(m.suggestedPrompts[0]).toMatch(/cite/i);
  });
});
