import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AmbiguousTargetError, detectTarget } from '../src/detect.js';

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
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({
      id: 'claude-code',
      configRoot: cwd,
    });
  });

  it('detects claude-code from ~/.claude but still installs into cwd', async () => {
    await mkdir(join(home, '.claude'));
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({
      id: 'claude-code',
      configRoot: cwd,
    });
  });

  it('detects openclaw from OPENCLAW_STATE_DIR', async () => {
    expect(await detectTarget({ cwd, home, env: { OPENCLAW_STATE_DIR: '/tmp/oc' } })).toEqual({
      id: 'openclaw',
      configRoot: '/tmp/oc',
    });
  });

  it('detects hermes from a native HERMES_HOME layout in cwd', async () => {
    await writeFile(join(cwd, 'config.yaml'), 'model: x\n');
    await writeFile(join(cwd, 'SOUL.md'), 'soul');
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({ id: 'hermes', configRoot: cwd });
  });

  it('returns null when nothing is found', async () => {
    expect(await detectTarget({ cwd, home, env: {} })).toBeNull();
  });

  it('throws AmbiguousTargetError when several project markers exist', async () => {
    await mkdir(join(cwd, '.claude'));
    await writeFile(join(cwd, 'openclaw.json'), '{}');
    await expect(detectTarget({ cwd, home, env: {} })).rejects.toThrow(AmbiguousTargetError);
  });

  it('project markers beat a user-level ~/.claude', async () => {
    await mkdir(join(home, '.claude'));
    await writeFile(join(cwd, 'config.yaml'), 'model: x\n');
    await writeFile(join(cwd, 'SOUL.md'), 'soul');
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({ id: 'hermes', configRoot: cwd });
  });

  it('detects claude-code from a project .mcp.json', async () => {
    await writeFile(join(cwd, '.mcp.json'), '{}');
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({
      id: 'claude-code',
      configRoot: cwd,
    });
  });

  it('installs hermes into ~/.hermes, never $HOME itself', async () => {
    await mkdir(join(home, '.hermes'));
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({
      id: 'hermes',
      configRoot: join(home, '.hermes'),
    });
  });

  it('prefers HERMES_HOME over ~/.hermes', async () => {
    await mkdir(join(home, '.hermes'));
    expect(await detectTarget({ cwd, home, env: { HERMES_HOME: '/tmp/hh' } })).toEqual({
      id: 'hermes',
      configRoot: '/tmp/hh',
    });
  });

  it('detects openclaw from the default ~/.openclaw/openclaw.json', async () => {
    await mkdir(join(home, '.openclaw'));
    await writeFile(join(home, '.openclaw', 'openclaw.json'), '{}');
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({
      id: 'openclaw',
      configRoot: join(home, '.openclaw'),
    });
  });

  it('throws AmbiguousTargetError listing candidates when several user-level installs exist', async () => {
    await mkdir(join(home, '.claude'));
    await mkdir(join(home, '.hermes'));
    const err = await detectTarget({ cwd, home, env: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AmbiguousTargetError);
    expect((err as AmbiguousTargetError).candidates.map((c) => c.id)).toEqual([
      'claude-code',
      'hermes',
    ]);
    expect((err as Error).message).toMatch(/--target/);
  });
});
