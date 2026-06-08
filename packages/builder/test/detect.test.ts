import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectTarget } from '../src/detect.js';

let cwd: string;
let home: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'uq-cwd-'));
  home = await mkdtemp(join(tmpdir(), 'uq-home-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('detectTarget', () => {
  it('detects claude-code from a project .claude dir, root = cwd', async () => {
    await mkdir(join(cwd, '.claude'));
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({ id: 'claude-code', configRoot: cwd });
  });

  it('detects claude-code from ~/.claude but still installs into cwd', async () => {
    await mkdir(join(home, '.claude'));
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({ id: 'claude-code', configRoot: cwd });
  });

  it('detects openclaw from OPENCLAW_STATE_DIR', async () => {
    expect(await detectTarget({ cwd, home, env: { OPENCLAW_STATE_DIR: '/tmp/oc' } }))
      .toEqual({ id: 'openclaw', configRoot: '/tmp/oc' });
  });

  it('detects hermes from a hermes.json', async () => {
    await writeFile(join(cwd, 'hermes.json'), '{}');
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({ id: 'hermes', configRoot: cwd });
  });

  it('returns null when nothing is found', async () => {
    expect(await detectTarget({ cwd, home, env: {} })).toBeNull();
  });

  it('prefers claude-code over hermes when both markers exist', async () => {
    await mkdir(join(cwd, '.claude'));
    await writeFile(join(cwd, 'hermes.json'), '{}');
    expect((await detectTarget({ cwd, home, env: {} }))!.id).toBe('claude-code');
  });
});
