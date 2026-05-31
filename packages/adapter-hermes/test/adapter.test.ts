import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '@uniqent/builder';
import { validateBundle } from '@uniqent/core';
import { runConformance } from '@uniqent/adapter-sdk';
import { claudeCodeAdapter } from '@uniqent/adapter-claude-code';
import { hermesAdapter } from '../src/index';
import { MEMORY_MAX } from '../src/memory';

function makeBundle(fillerFacts = 60) {
  const b = Brain.create({
    name: 'dev',
    displayName: 'Dev',
    version: '0.1.0',
    description: 'd',
    author: { name: 'me' },
    license: 'CC0-1.0',
    tags: [],
  });
  b.setPersona('# Persona\nHermes agent.');
  b.addMcpFromCatalog('github');
  b.addSkill('triage', '---\nname: triage\n---\nTriage.\n');
  b.addChannelFromCatalog('telegram');
  b.addMemory({
    id: 'keep',
    kind: 'fact',
    text: 'KEEP-ME-high-importance',
    createdAt: '2026-05-31T00:00:00.000Z',
    importance: 1,
  });
  for (let i = 0; i < fillerFacts; i++) {
    b.addMemory({
      id: `d${i}`,
      kind: 'fact',
      text: `low importance filler fact number ${i} ${'x'.repeat(30)}`,
      createdAt: '2026-05-31T00:00:00.000Z',
      importance: 0,
    });
  }
  return b.toBundle();
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'uniqent-hermes-'));
}

const RESOLVED = { github_pat: 'ghp_demo000111222333444', telegram_bot_token: 'bot:secrettoken' };

describe('hermesAdapter.plan', () => {
  it('reports memory truncation and requires mcp+channel credentials', async () => {
    const plan = await hermesAdapter.plan(makeBundle(), { root: '/tmp/x' });
    expect(plan.lossiness.some((l) => l.component === 'memory' && l.action === 'truncated')).toBe(
      true,
    );
    expect(plan.requiresCredentials).toEqual(
      expect.arrayContaining(['github_pat', 'telegram_bot_token']),
    );
  });
});

describe('hermesAdapter.apply', () => {
  it('writes bounded memory (prioritized) and keeps secrets only in .env', async () => {
    const root = tmp();
    try {
      const bundle = makeBundle();
      const plan = await hermesAdapter.plan(bundle, { root });
      await hermesAdapter.apply(bundle, plan, RESOLVED, { root });

      const memory = readFileSync(join(root, 'MEMORY.md'), 'utf8');
      expect(memory.length).toBeLessThanOrEqual(MEMORY_MAX);
      expect(memory).toContain('KEEP-ME-high-importance'); // highest importance survives
      expect(existsSync(join(root, 'SOUL.md'))).toBe(true);

      const hermes = readFileSync(join(root, 'hermes.json'), 'utf8');
      expect(hermes).toContain('Bearer ${GITHUB_PAT}'); // env reference, not the token
      expect(hermes).not.toContain('ghp_demo000111222333444'); // no secret in config

      const env = readFileSync(join(root, '.env'), 'utf8');
      expect(env).toContain('GITHUB_PAT=ghp_demo000111222333444');
      expect(env).toContain('TELEGRAM_BOT_TOKEN=bot:secrettoken');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes the conformance harness', async () => {
    const root = tmp();
    try {
      const r = await runConformance(hermesAdapter, makeBundle(), root);
      expect(r.ok, JSON.stringify(r.checks)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('captures a Hermes setup back into a valid bundle', async () => {
    const root = tmp();
    try {
      const bundle = makeBundle();
      const plan = await hermesAdapter.plan(bundle, { root });
      await hermesAdapter.apply(bundle, plan, RESOLVED, { root });
      const captured = await hermesAdapter.export({ root });
      expect(captured.persona()).toContain('Hermes agent');
      expect(captured.skillNames()).toContain('triage');
      expect(validateBundle(captured).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('one brain, two frameworks', () => {
  it('installs the same .uniqent into both Claude Code and Hermes', async () => {
    const bundle = makeBundle();
    const cc = tmp();
    const hz = tmp();
    try {
      const ccPlan = await claudeCodeAdapter.plan(bundle, { root: cc });
      await claudeCodeAdapter.apply(
        bundle,
        ccPlan,
        { github_pat: RESOLVED.github_pat },
        { root: cc },
      );
      const hzPlan = await hermesAdapter.plan(bundle, { root: hz });
      await hermesAdapter.apply(bundle, hzPlan, RESOLVED, { root: hz });

      // Claude Code: skills + AGENTS.md + .mcp.json
      expect(existsSync(join(cc, '.claude/skills/triage/SKILL.md'))).toBe(true);
      expect(existsSync(join(cc, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(cc, '.mcp.json'))).toBe(true);
      // Hermes: SOUL.md + bounded MEMORY.md + hermes.json
      expect(existsSync(join(hz, 'SOUL.md'))).toBe(true);
      expect(readFileSync(join(hz, 'MEMORY.md'), 'utf8').length).toBeLessThanOrEqual(MEMORY_MAX);
      expect(existsSync(join(hz, 'hermes.json'))).toBe(true);

      // Same brain, different lossiness: Claude Code transforms memory; Hermes truncates it.
      expect(ccPlan.lossiness.some((l) => l.action === 'transformed')).toBe(true);
      expect(hzPlan.lossiness.some((l) => l.action === 'truncated')).toBe(true);
    } finally {
      rmSync(cc, { recursive: true, force: true });
      rmSync(hz, { recursive: true, force: true });
    }
  });
});
