import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OWNER_ONLY, writeToDisk, type OutputWrite } from '@uniqent/adapter-sdk';
import {
  buildInstallFixture,
  snapshot,
  writeSeed,
  type FixtureTarget,
  type InstallFixture,
} from '../scripts/emit-install-fixtures.js';

const committed = (t: FixtureTarget) =>
  JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'install', `${t}.json`), 'utf8'),
  ) as InstallFixture;

/** A fixture write's mode as the adapter-sdk type; anything but 0600 or null is a broken fixture. */
function writeMode(path: string, mode: number | null): OutputWrite['mode'] {
  if (mode === null || mode === OWNER_ONLY) return mode;
  throw new Error(`fixture write "${path}" has mode ${mode.toString(8)}; only 600 or null exist`);
}

describe('the CLI still produces the golden install + capture trees', () => {
  for (const target of ['claude-code', 'hermes', 'openclaw'] as const) {
    it(target, async () => {
      expect(await buildInstallFixture(target)).toEqual(committed(target));
    });
  }
});

describe("the pure translate's writes, applied onto the seed, give the CLI tree", () => {
  for (const target of ['claude-code', 'hermes', 'openclaw'] as const) {
    it(target, async () => {
      const fixture = committed(target);
      const root = await mkdtemp(join(tmpdir(), `uniqent-parity-${target}-`));
      try {
        await writeSeed(root, fixture.seed);
        await writeToDisk(
          fixture.writes.map((w) => ({
            root,
            path: w.path,
            bytes: Buffer.from(w.bytesBase64, 'base64'),
            mode: writeMode(w.path, w.mode),
          })),
        );
        expect(await snapshot(root)).toEqual(fixture.tree);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});
