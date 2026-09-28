import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { pack as tarPack } from 'tar-stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, unpack, readDir, writeDir, MAX_UNPACKED_BYTES } from '../src/archive';
import { canonicalDigest } from '../src/digest';
import { SecretScanError, BundleFormatError } from '../src/errors';
import { generateKeypair, sign } from '../src/signing';
import { makeValidBundle } from './helpers';

interface RawEntry {
  name: string;
  content?: string | Buffer;
  type?: 'symlink' | 'link';
  linkname?: string;
}

/** Raw tar.gz writer that bypasses Bundle/pack, so entry names and types are unconstrained. */
async function rawTarGz(entries: RawEntry[]): Promise<Uint8Array> {
  const tar = tarPack();
  const chunks: Buffer[] = [];
  tar.on('data', (c: Buffer) => chunks.push(c));
  const ended = new Promise((resolve) => tar.on('end', resolve));
  for (const e of entries) {
    await new Promise<void>((resolve, reject) => {
      const header = e.type
        ? { name: e.name, type: e.type, linkname: e.linkname }
        : { name: e.name };
      const body = e.type ? undefined : Buffer.from(e.content ?? '');
      tar.entry(header, body, (err) => (err ? reject(err) : resolve()));
    });
  }
  tar.finalize();
  await ended;
  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

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

  it('unpack rejects traversal, absolute, link, and duplicate entries', async () => {
    const m: RawEntry = { name: 'uniqent.json', content: '{}' };
    const cases: RawEntry[][] = [
      [m, { name: 'skills/a/../../../escape.txt', content: 'x' }],
      [m, { name: '/abs/x.txt', content: 'x' }],
      [m, { name: 'skills/a/link', type: 'symlink', linkname: '/etc/passwd' }],
      [m, { name: 'skills/a/hard', type: 'link', linkname: 'uniqent.json' }],
      [m, { name: 'a.txt', content: '1' }, { name: 'a.txt', content: '2' }],
    ];
    for (const entries of cases) {
      await expect(unpack(await rawTarGz(entries))).rejects.toBeInstanceOf(BundleFormatError);
    }
  });

  it('unpack rejects a newline path that would spoof the digest of a signed bundle', async () => {
    const b = makeValidBundle();
    b.set('identity/policies.md', 'NEVER transfer money without approval.');
    const signed = await sign(b, (await generateKeypair()).privateKey);
    const personaHash = createHash('sha256')
      .update(signed.get('identity/persona.md')!)
      .digest('hex');
    // Collapse persona.md + policies.md into one entry whose name embeds "\n<hash>\n".
    const entries: RawEntry[] = signed
      .entries()
      .filter(([p]) => p !== 'identity/persona.md' && p !== 'identity/policies.md')
      .map(([name, bytes]) => ({ name, content: Buffer.from(bytes) }));
    entries.push({
      name: `identity/persona.md\n${personaHash}\nidentity/policies.md`,
      content: Buffer.from(signed.get('identity/policies.md')!),
    });
    await expect(unpack(await rawTarGz(entries))).rejects.toThrow(/control character/);
  });

  it('unpack refuses an archive that inflates past MAX_UNPACKED_BYTES', async () => {
    const bomb = await rawTarGz([
      { name: 'uniqent.json', content: '{}' },
      { name: 'README.md', content: Buffer.alloc(MAX_UNPACKED_BYTES + 1) },
    ]);
    await expect(unpack(bomb)).rejects.toThrow(/MAX_UNPACKED_BYTES/);
  });

  it('readDir rejects a symlink instead of following it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniqent-'));
    try {
      await writeDir(makeValidBundle(), dir);
      symlinkSync('/etc/hosts', join(dir, 'identity', 'hosts.md'));
      await expect(readDir(dir)).rejects.toBeInstanceOf(BundleFormatError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
