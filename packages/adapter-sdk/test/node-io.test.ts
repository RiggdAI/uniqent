import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OWNER_ONLY, readFromDisk, writeToDisk } from '../src/index';

let root: string;
const text = (s: string) => new TextEncoder().encode(s);
const mode = async (p: string) => (await stat(p)).mode & 0o777;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'uq-node-io-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readFromDisk', () => {
  it('reads requested files and omits absent ones', async () => {
    await writeFile(join(root, 'a.md'), 'A');
    const read = await readFromDisk({
      files: [
        { root, path: 'a.md' },
        { root, path: 'missing.md' },
      ],
      finds: [],
    });
    expect([...read.keys()]).toEqual([join(root, 'a.md')]);
    expect(new TextDecoder().decode(read.get(join(root, 'a.md')))).toBe('A');
  });

  it('rethrows errors other than a missing file', async () => {
    await mkdir(join(root, 'dir'));
    await expect(readFromDisk({ files: [{ root, path: 'dir' }], finds: [] })).rejects.toThrow(
      /EISDIR/,
    );
  });

  it('finds a file at any depth, skipping dot dirs, skipDirs and symlinked dirs', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'uq-node-io-out-'));
    try {
      for (const dir of ['skills/a', 'skills/b/nested', 'skills/.git', 'skills/node_modules/x'])
        await mkdir(join(root, dir), { recursive: true });
      for (const dir of ['skills/a', 'skills/b/nested', 'skills/.git', 'skills/node_modules/x'])
        await writeFile(join(root, dir, 'SKILL.md'), dir);
      await writeFile(join(outside, 'SKILL.md'), 'outside');
      await symlink(outside, join(root, 'skills', 'linked'));
      const read = await readFromDisk({
        files: [],
        finds: [{ root, dir: 'skills', fileName: 'SKILL.md', skipDirs: ['node_modules'] }],
      });
      expect([...read.keys()].sort()).toEqual([
        join(root, 'skills/a/SKILL.md'),
        join(root, 'skills/b/nested/SKILL.md'),
      ]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('finds nothing when the start dir is absent', async () => {
    const read = await readFromDisk({
      files: [],
      finds: [{ root, dir: 'skills', fileName: 'SKILL.md', skipDirs: [] }],
    });
    expect(read.size).toBe(0);
  });
});

describe('writeToDisk', () => {
  it('creates parents and writes owner-only files as 0600, tightening an existing file', async () => {
    await writeFile(join(root, '.env'), 'OLD=1\n', { mode: 0o644 });
    await chmod(join(root, '.env'), 0o644);
    await writeToDisk([
      { root, path: 'deep/new/.env', bytes: text('A=1\n'), mode: OWNER_ONLY },
      { root, path: '.env', bytes: text('B=2\n'), mode: OWNER_ONLY },
    ]);
    expect(await readFile(join(root, 'deep/new/.env'), 'utf8')).toBe('A=1\n');
    expect(await mode(join(root, 'deep/new/.env'))).toBe(0o600);
    expect(await readFile(join(root, '.env'), 'utf8')).toBe('B=2\n');
    expect(await mode(join(root, '.env'))).toBe(0o600);
  });

  it('keeps an existing file mode when mode is null', async () => {
    await writeFile(join(root, 'SOUL.md'), 'old');
    await chmod(join(root, 'SOUL.md'), 0o640);
    await writeToDisk([{ root, path: 'SOUL.md', bytes: text('new'), mode: null }]);
    expect(await readFile(join(root, 'SOUL.md'), 'utf8')).toBe('new');
    expect(await mode(join(root, 'SOUL.md'))).toBe(0o640);
  });
});
