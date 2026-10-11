import { describe, expect, it } from 'vitest';
import {
  confineRelative,
  displayPath,
  gatherInputs,
  joinPath,
  InputsUnsettledError,
  PathEscapeError,
  readText,
  resolvePosix,
  sameBytes,
  type ReadFiles,
} from '../src/pure';

describe('pure paths', () => {
  it('confines relative paths and folds dot segments', () => {
    expect(confineRelative('/r', 'skills/x/SKILL.md')).toBe('skills/x/SKILL.md');
    expect(confineRelative('/r', 'skills/x/../y/SKILL.md')).toBe('skills/y/SKILL.md');
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', '', '.', 'a\0b'])
      expect(() => confineRelative('/r', bad), bad).toThrow(PathEscapeError);
  });
  it('joins and resolves POSIX paths', () => {
    expect(joinPath('/h/.hermes/', 'SOUL.md')).toBe('/h/.hermes/SOUL.md');
    expect(resolvePosix('/cwd', 'ws/../ws2')).toBe('/cwd/ws2');
    expect(resolvePosix('/cwd', '/abs/./w')).toBe('/abs/w');
  });
  it('displays writes under root relative to it, others absolute', () => {
    expect(displayPath('/s', { root: '/s', path: '.env' })).toBe('.env');
    expect(displayPath('/s', { root: '/s/workspace', path: 'SOUL.md' })).toBe('workspace/SOUL.md');
    expect(displayPath('/s', { root: '/ws', path: 'SOUL.md' })).toBe('/ws/SOUL.md');
  });
  it('compares bytes', () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
  });
  it('decodes text like Node readFile utf8: BOM kept, invalid bytes replaced', () => {
    const read: ReadFiles = new Map([['/r/a', new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0xff])]]);
    expect(readText(read, '/r', 'a')).toBe('﻿h�');
    expect(readText(read, '/r', 'missing')).toBeUndefined();
  });
});

describe('gatherInputs', () => {
  it('reads until the adapter asks for nothing new, never re-reading a file', async () => {
    const asked: string[] = [];
    const disk = new Map([
      ['/r/a', new Uint8Array([1])],
      ['/r/b', new Uint8Array([2])],
    ]);
    const read = await gatherInputs(
      (r) => ({
        files: [{ root: '/r', path: 'a' }, ...(r.has('/r/a') ? [{ root: '/r', path: 'b' }] : [])],
        finds: [],
      }),
      async (req) => {
        asked.push(...req.files.map((f) => f.path));
        return new Map(
          req.files.flatMap((f) => {
            const v = disk.get(`${f.root}/${f.path}`);
            return v ? [[`${f.root}/${f.path}`, v] as const] : [];
          }),
        );
      },
    );
    expect([...read.keys()]).toEqual(['/r/a', '/r/b']);
    expect(asked).toEqual(['a', 'b']);
  });
  it('throws InputsUnsettledError when requests never settle', async () => {
    let n = 0;
    await expect(
      gatherInputs(
        () => ({ files: [{ root: '/r', path: `f${n++}` }], finds: [] }),
        async (): Promise<ReadFiles> => new Map(),
      ),
    ).rejects.toThrow(InputsUnsettledError);
  });
});
