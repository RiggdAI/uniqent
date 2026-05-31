import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, unpack, readDir, writeDir } from '../src/archive';
import { canonicalDigest } from '../src/digest';
import { SecretScanError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('archive', () => {
  it('round-trips pack/unpack with a stable content digest', async () => {
    const b = makeValidBundle();
    const before = canonicalDigest(b);
    const bytes = await pack(b);
    const restored = await unpack(bytes);
    expect(canonicalDigest(restored)).toBe(before);
    expect(restored.manifest().name).toBe('test-brain');
  });

  it('pack throws SecretScanError on a planted secret', async () => {
    const b = makeValidBundle();
    b.set('notes.md', 'ghp_0123456789abcdefghijklmnopqrstuvwx');
    await expect(pack(b)).rejects.toBeInstanceOf(SecretScanError);
  });

  it('round-trips through a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniqent-'));
    try {
      const b = makeValidBundle();
      await writeDir(b, dir);
      const restored = await readDir(dir);
      expect(canonicalDigest(restored)).toBe(canonicalDigest(b));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unpack throws on an archive with no manifest', async () => {
    const b = makeValidBundle();
    b.delete('uniqent.json');
    const bytes = await pack(b, { skipValidation: true });
    await expect(unpack(bytes)).rejects.toThrow();
  });
});
