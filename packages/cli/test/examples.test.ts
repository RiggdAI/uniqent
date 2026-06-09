import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readDir, validateBundle, pack } from '@uniqent/core';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '../../../examples');

const EXAMPLES = [
  'dev-powerpack',
  'research-analyst',
  'personal-assistant',
  // Voltade-inspired solution brains (one per category).
  'support-concierge',
  'recruiter-screen',
  'ops-orchestrator',
  'menu-planner',
  'care-admin',
];

describe('example bundles', () => {
  for (const name of EXAMPLES) {
    it(`${name} validates and packs (no secrets)`, async () => {
      const bundle = await readDir(resolve(examplesDir, name));
      expect(validateBundle(bundle).ok).toBe(true);
      const bytes = await pack(bundle); // throws if the secret-scan trips
      expect(bytes.length).toBeGreaterThan(0);
    });
  }

  it('every example manifest declares counts that match its components', async () => {
    for (const name of EXAMPLES) {
      const bundle = await readDir(resolve(examplesDir, name));
      const m = JSON.parse(new TextDecoder().decode(bundle.get('uniqent.json')!));
      // memory.facts must equal the number of JSONL lines actually present.
      const factsFile = bundle.get('memory/facts.jsonl');
      const factLines = factsFile
        ? new TextDecoder()
            .decode(factsFile)
            .split('\n')
            .filter((l) => l.trim().length > 0).length
        : 0;
      expect(m.components.memory.facts, `${name} memory.facts`).toBe(factLines);
      // every declared credential must be consumed by a real mcp/channel.
      for (const c of m.credentials ?? []) {
        expect(
          Array.isArray(c.consumedBy) && c.consumedBy.length > 0,
          `${name} cred ${c.ref}`,
        ).toBe(true);
      }
    }
  });

  it('research-analyst is a rich hero: ≥10 facts, creds-free, has suggestedPrompts', async () => {
    const bundle = await readDir(resolve(examplesDir, 'research-analyst'));
    const m = JSON.parse(new TextDecoder().decode(bundle.get('uniqent.json')!));
    expect(m.components.memory.facts).toBeGreaterThanOrEqual(10);
    expect(m.credentials).toEqual([]);
    expect(Array.isArray(m.suggestedPrompts)).toBe(true);
    expect(m.suggestedPrompts[0]).toMatch(/cite/i);
  });
});
