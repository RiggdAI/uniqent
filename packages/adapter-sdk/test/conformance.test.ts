import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bundle, PATHS } from '@uniqent/core';
import { runConformance, type Adapter } from '../src/index';

const base: Adapter = {
  id: 'base',
  displayName: 'Base',
  async detect() {
    return { present: true };
  },
  async plan() {
    return {
      writes: [{ path: 'out.txt', summary: 'x' }],
      mcpRegistrations: [],
      channelRegistrations: [],
      lossiness: [],
      requiresCredentials: [],
    };
  },
  async apply(_b, _p, _r, { root }) {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'out.txt'), 'deterministic');
    return { written: ['out.txt'], notes: [] };
  },
  async export() {
    return Bundle.empty();
  },
};

function withTmp<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'uniqent-conf-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('runConformance', () => {
  it('passes for a deterministic, clean adapter', async () => {
    await withTmp(async (root) => {
      const r = await runConformance(base, Bundle.empty(), root);
      expect(r.ok).toBe(true);
    });
  });

  it('fails idempotency for a non-deterministic adapter', async () => {
    const flaky: Adapter = {
      ...base,
      async apply(_b, _p, _r, { root }) {
        await mkdir(root, { recursive: true });
        await writeFile(join(root, 'out.txt'), `t-${Date.now()}-${Math.random()}`);
        return { written: ['out.txt'], notes: [] };
      },
    };
    await withTmp(async (root) => {
      const r = await runConformance(flaky, Bundle.empty(), root);
      expect(r.ok).toBe(false);
      expect(r.checks.find((c) => c.name.includes('idempotent'))?.pass).toBe(false);
    });
  });

  it('fails the no-secrets check when an adapter writes a secret', async () => {
    const leaky: Adapter = {
      ...base,
      async apply(_b, _p, _r, { root }) {
        await mkdir(root, { recursive: true });
        await writeFile(join(root, 'out.txt'), `token ghp_${'a'.repeat(36)}`);
        return { written: ['out.txt'], notes: [] };
      },
    };
    await withTmp(async (root) => {
      const r = await runConformance(leaky, Bundle.empty(), root);
      expect(r.ok).toBe(false);
      expect(r.checks.find((c) => c.name.includes('secret'))?.pass).toBe(false);
    });
  });
});

describe('runConformance path + loss checks', () => {
  it('fails when an adapter reports a write outside root', async () => {
    const escaping: Adapter = {
      ...base,
      async apply(_b, _p, _r, { root }) {
        await mkdir(root, { recursive: true });
        await writeFile(join(root, 'out.txt'), 'deterministic');
        return { written: ['out.txt', '../outside.txt'], notes: [] };
      },
    };
    await withTmp(async (root) => {
      const r = await runConformance(escaping, Bundle.empty(), root);
      const check = r.checks.find((c) => c.name.includes('inside root'));
      expect(check?.pass).toBe(false);
      expect(check?.detail).toBe('../outside.txt');
    });
  });

  it('fails when tasks, episodic memory, or runtime config vanish silently', async () => {
    const bundle = Bundle.empty();
    bundle.set(
      'tasks/daily.json',
      JSON.stringify({
        id: 'daily',
        name: 'Daily',
        trigger: { type: 'manual' },
        action: { kind: 'prompt', prompt: 'summarize' },
        enabled: true,
      }),
    );
    bundle.set(
      PATHS.episodic,
      JSON.stringify({
        id: 'e1',
        kind: 'episodic',
        text: 'x',
        createdAt: '2026-05-31T00:00:00.000Z',
      }),
    );
    bundle.set(PATHS.runtime, JSON.stringify({ model: { name: 'opus' } }));
    await withTmp(async (root) => {
      const r = await runConformance(base, bundle, root);
      expect(r.checks.find((c) => c.name.includes('silent loss'))?.detail).toBe(
        'tasks, episodic memory, runtime config',
      );
    });
  });
});
