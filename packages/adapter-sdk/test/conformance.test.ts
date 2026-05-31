import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bundle } from '@uniqent/core';
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
