import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFeaturedBundle } from '../src/featured.js';
import { run } from '../src/run.js';

describe('loadFeaturedBundle', () => {
  it('loads research-analyst as an unpackable bundle', async () => {
    const bundle = await loadFeaturedBundle('research-analyst');
    const manifest = bundle.get('uniqent.json');
    expect(manifest).toBeDefined();
    const m = JSON.parse(new TextDecoder().decode(manifest!));
    expect(m.name).toBe('research-analyst');
  });
});

function collectIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { log: (m: string) => out.push(m), error: (m: string) => err.push(m) },
    out,
    err,
  };
}

describe('uniqent try', () => {
  it('--list prints featured brains', async () => {
    const { io, out } = collectIo();
    const code = await run(['try', '--list'], io);
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/research-analyst/);
  });

  it('installs research-analyst into a detected claude-code root and prints a suggested prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uq-try-'));
    await mkdir(join(root, '.claude')); // makes detectTarget pick claude-code @ root
    const { io, out } = collectIo();
    const code = await run(['try', 'research-analyst', '--root', root, '--yes'], io);
    expect(code).toBe(0);
    const log = out.join('\n');
    expect(log).toMatch(/Research Analyst/);
    expect(log).toMatch(/signature: valid/);
    expect(log).toMatch(/cite every claim/i); // the suggested prompt payoff
    const written = await readdir(join(root, '.claude'), { recursive: true } as never);
    expect(written.length).toBeGreaterThan(0);
    await rm(root, { recursive: true, force: true });
  });

  it('unknown brain lists featured and exits non-zero', async () => {
    const { io, err } = collectIo();
    const code = await run(['try', 'no-such-brain'], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/research-analyst/);
  });
});
