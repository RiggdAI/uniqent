import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '@uniqent/builder';
import { validateBundle } from '@uniqent/core';
import { runConformance } from '@uniqent/adapter-sdk';
import { openClawAdapter } from '../src/index';

function makeBundle() {
  const b = Brain.create({
    name: 'dev',
    displayName: 'Dev',
    version: '0.1.0',
    description: 'd',
    author: { name: 'me' },
    license: 'CC0-1.0',
    tags: [],
  });
  b.setPersona('# Persona\nClaw agent.');
  b.addMcpFromCatalog('github');
  b.addSkill('triage', '---\nname: triage\n---\nTriage.\n');
  b.addChannelFromCatalog('telegram');
  b.addMemory({
    id: 'f1',
    kind: 'fact',
    text: 'prefers pnpm',
    createdAt: '2026-05-31T00:00:00.000Z',
  });
  b.setProfile({ name: 'Max', role: 'founder' });
  return b.toBundle();
}

const RESOLVED = { github_pat: 'ghp_demo000111222333444', telegram_bot_token: 'bot:secrettoken' };

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'uniqent-oc-'));
}

describe('openClawAdapter', () => {
  it('plans writes and requires mcp+channel credentials', async () => {
    const plan = await openClawAdapter.plan(makeBundle(), { root: '/tmp/x' });
    const paths = plan.writes.map((w) => w.path);
    expect(paths).toEqual(
      expect.arrayContaining(['SOUL.md', 'MEMORY.md', 'skills/triage/SKILL.md', 'openclaw.json']),
    );
    expect(plan.requiresCredentials).toEqual(
      expect.arrayContaining(['github_pat', 'telegram_bot_token']),
    );
  });

  it('writes SOUL.md, MEMORY.md (with profile), and openclaw.json with the channel + mcp creds', async () => {
    const root = tmp();
    try {
      const bundle = makeBundle();
      const plan = await openClawAdapter.plan(bundle, { root });
      await openClawAdapter.apply(bundle, plan, RESOLVED, { root });

      expect(readFileSync(join(root, 'SOUL.md'), 'utf8')).toContain('Claw agent');
      const memory = readFileSync(join(root, 'MEMORY.md'), 'utf8');
      expect(memory).toContain('prefers pnpm');
      expect(memory).toContain('User profile');
      expect(memory).toContain('Max');
      expect(existsSync(join(root, 'skills/triage/SKILL.md'))).toBe(true);

      const config = JSON.parse(readFileSync(join(root, 'openclaw.json'), 'utf8'));
      expect(config.mcpServers.github.headers.Authorization).toBe('Bearer ghp_demo000111222333444');
      expect(config.channels[0]).toMatchObject({ id: 'telegram', token: 'bot:secrettoken' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes the conformance harness', async () => {
    const root = tmp();
    try {
      const r = await runConformance(openClawAdapter, makeBundle(), root);
      expect(r.ok, JSON.stringify(r.checks)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('captures an OpenClaw setup back into a valid bundle', async () => {
    const root = tmp();
    try {
      const bundle = makeBundle();
      const plan = await openClawAdapter.plan(bundle, { root });
      await openClawAdapter.apply(bundle, plan, RESOLVED, { root });
      const captured = await openClawAdapter.export({ root });
      expect(captured.persona()).toContain('Claw agent');
      expect(captured.skillNames()).toContain('triage');
      expect(validateBundle(captured).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
