import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMcpConfig } from '@uniqent/builder';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ports');

interface PortCase {
  name: string;
  input: unknown;
  expected: unknown;
}

describe('normalize-cases fixture drift guard', () => {
  it('re-derives each normalize case from live TS and matches the committed fixture', async () => {
    const raw = await readFile(join(FIXTURES_DIR, 'normalize-cases.json'), 'utf8');
    const cases: PortCase[] = JSON.parse(raw);
    for (const c of cases) {
      const actual = normalizeMcpConfig(c.input);
      expect(actual, `case: ${c.name}`).toEqual(c.expected);
    }
  });
});
