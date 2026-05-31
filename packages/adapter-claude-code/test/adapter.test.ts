import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '@uniqent/builder';
import { validateBundle } from '@uniqent/core';
import { runConformance } from '@uniqent/adapter-sdk';
import { claudeCodeAdapter } from '../src/index';

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
  b.setPersona('# Persona\nAtlas, ships fast.');
  b.addMemory({
    id: 'f1',
    kind: 'fact',
    text: 'prefers TypeScript',
    createdAt: '2026-05-31T00:00:00.000Z',
  });
  b.addMcpFromCatalog('github');
  b.addSkillFromCatalog('code-review');
  b.addChannelFromCatalog('telegram'); // dropped by Claude Code → exercises lossiness
  return b.toBundle();
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'uniqent-cc-'));
}

describe('claudeCodeAdapter.plan', () => {
  it('lists writes, mcp-consumed credentials, and lossiness', async () => {
    const plan = await claudeCodeAdapter.plan(makeBundle(), { root: '/tmp/x' });
    const paths = plan.writes.map((w) => w.path);
    expect(paths).toContain('.claude/skills/code-review/SKILL.md');
    expect(paths).toContain('AGENTS.md');
    expect(paths).toContain('.mcp.json');
    expect(plan.requiresCredentials).toContain('github_pat'); // consumed by mcp
    expect(plan.requiresCredentials).not.toContain('telegram_bot_token'); // channel-only
    expect(plan.lossiness.map((l) => l.component)).toEqual(
      expect.arrayContaining(['channels', 'memory']),
    );
  });
});

describe('claudeCodeAdapter.apply', () => {
  it('writes skills, AGENTS.md, and .mcp.json with the injected credential', async () => {
    const root = tmp();
    try {
      const bundle = makeBundle();
      const plan = await claudeCodeAdapter.plan(bundle, { root });
      await claudeCodeAdapter.apply(
        bundle,
        plan,
        { github_pat: 'ghp_demo000111222333444555666' },
        { root },
      );

      expect(existsSync(join(root, '.claude/skills/code-review/SKILL.md'))).toBe(true);
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('Atlas');
      const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
      expect(mcp.mcpServers.github.type).toBe('http');
      expect(mcp.mcpServers.github.headers.Authorization).toBe(
        'Bearer ghp_demo000111222333444555666',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is idempotent (second apply identical)', async () => {
    const root = tmp();
    try {
      const bundle = makeBundle();
      const plan = await claudeCodeAdapter.plan(bundle, { root });
      const resolved = { github_pat: 'ghp_demo000111222333444555666' };
      await claudeCodeAdapter.apply(bundle, plan, resolved, { root });
      const first =
        readFileSync(join(root, '.mcp.json'), 'utf8') +
        readFileSync(join(root, 'AGENTS.md'), 'utf8');
      await claudeCodeAdapter.apply(bundle, plan, resolved, { root });
      const second =
        readFileSync(join(root, '.mcp.json'), 'utf8') +
        readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(second).toBe(first);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes the conformance harness', async () => {
    const root = tmp();
    try {
      const r = await runConformance(claudeCodeAdapter, makeBundle(), root);
      expect(r.ok, JSON.stringify(r.checks)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('claudeCodeAdapter.export', () => {
  it('captures an installed project back into a valid bundle', async () => {
    const root = tmp();
    try {
      const bundle = makeBundle();
      const plan = await claudeCodeAdapter.plan(bundle, { root });
      await claudeCodeAdapter.apply(
        bundle,
        plan,
        { github_pat: 'ghp_demo000111222333444555666' },
        { root },
      );

      const captured = await claudeCodeAdapter.export({ root });
      expect(captured.skillNames()).toContain('code-review');
      expect(captured.persona()).toContain('Atlas');
      expect(captured.mcpServers().map((s) => s.id)).toContain('github');
      expect(validateBundle(captured).ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
