import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInstallFixture, type FixtureTarget } from '../scripts/emit-install-fixtures.js';

const committed = (t: FixtureTarget) =>
  JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'install', `${t}.json`), 'utf8'),
  ) as unknown;

describe('the CLI still produces the golden install + capture trees', () => {
  for (const target of ['claude-code', 'hermes', 'openclaw'] as const) {
    it(target, async () => {
      expect(await buildInstallFixture(target)).toEqual(committed(target));
    });
  }
});
