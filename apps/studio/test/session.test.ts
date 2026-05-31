import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudioSession } from '../src/server/session';
import { unpack, validateBundle, verify } from '@uniqent/core';

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, 'base64'));
}

describe('StudioSession', () => {
  it('becomes valid after meta + persona + catalog mcp + skill', () => {
    const s = new StudioSession();
    s.setMeta({ name: 'demo', displayName: 'Demo', description: 'd' });
    s.setPersona('# Persona\nHi.\n');
    s.addMcpFromCatalog('github');
    s.addCustomSkill('code-review', '---\nname: code-review\n---\nReview.\n');
    s.addFact({ text: 'prefers TS' });
    expect(s.state().validation.ok).toBe(true);
  });

  it('surfaces the github credential requirement', () => {
    const s = new StudioSession();
    s.addMcpFromCatalog('github');
    const cred = s.state().manifest.credentials.find((c) => c.ref === 'github_pat');
    expect(cred?.consumedBy).toContain('mcp:github');
  });

  it('imports memory from lines and from structured items', () => {
    const s = new StudioSession();
    expect(s.importLines('first fact\n\n second fact \n')).toBe(2);
    s.importItems([
      { text: 'a decision', kind: 'decision', importance: 0.9 },
      { text: '' }, // skipped (blank)
      { text: 'episodic note', kind: 'episodic' }, // routes to episodic, not facts
    ]);
    const mem = s.state().manifest.components.memory;
    expect(mem.facts).toBe(3); // 2 lines + 1 decision
    expect(mem.episodic).toBe(1);
  });

  it('adds a channel (with its credential) and a task', () => {
    const s = new StudioSession();
    s.addChannelFromCatalog('telegram');
    s.addTask({
      name: 'Daily triage',
      triggerType: 'schedule',
      cron: '0 9 * * *',
      prompt: 'Triage PRs',
    });
    const m = s.state().manifest;
    expect(m.components.channels).toContain('telegram');
    expect(m.components.tasks).toHaveLength(1);
    expect(m.credentials.find((c) => c.ref === 'telegram_bot_token')?.consumedBy).toContain(
      'channel:telegram',
    );
  });

  it('adds a custom skill and a custom MCP server (with auto credential)', () => {
    const s = new StudioSession();
    s.setPersona('# Persona\n');
    s.addCustomSkill('triage', '---\nname: triage\n---\nTriage issues.\n');
    s.addCustomMcp({
      id: 'acme',
      transport: 'streamable-http',
      url: 'https://acme.example.com/mcp',
      auth: { type: 'bearer', credentialRef: 'acme_token' },
    });
    const m = s.state().manifest;
    expect(m.components.skills).toContain('triage');
    expect(m.components.mcp).toContain('acme');
    expect(m.credentials.find((c) => c.ref === 'acme_token')?.consumedBy).toContain('mcp:acme');
    expect(s.state().validation.ok).toBe(true);
  });

  it('imports a skill from a URL', async () => {
    const s = new StudioSession();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('---\nname: triage\n---\nTriage issues.\n')) as typeof fetch;
    try {
      await s.importSkillFromUrl('https://example.com/skills/triage/SKILL.md');
      expect(s.state().manifest.components.skills).toContain('triage');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('imports mcp servers in bulk', () => {
    const s = new StudioSession();
    expect(
      s.importMcpServers([
        { id: 'fs', transport: 'stdio', command: 'npx', auth: { type: 'none' } },
        { id: 'web', transport: 'stdio', command: 'fetch', auth: { type: 'none' } },
      ]),
    ).toBe(2);
    expect(s.state().manifest.components.mcp).toEqual(expect.arrayContaining(['fs', 'web']));
  });

  it('rejects an invalid custom MCP server', () => {
    const s = new StudioSession();
    expect(() =>
      s.addCustomMcp({ id: 'bad', transport: 'streamable-http', auth: { type: 'none' } }),
    ).toThrow();
  });

  it('removes mcp servers and skills', () => {
    const s = new StudioSession();
    s.addMcpFromCatalog('github');
    s.addCustomSkill('code-review', '---\nname: code-review\n---\nReview.\n');
    s.removeMcp('github');
    s.removeSkill('code-review');
    const m = s.state().manifest;
    expect(m.components.mcp).not.toContain('github');
    expect(m.components.skills).not.toContain('code-review');
  });

  it('exports bytes that unpack + validate', async () => {
    const s = new StudioSession();
    s.setMeta({ name: 'demo' });
    s.setPersona('# Persona\n');
    s.addMcpFromCatalog('github');
    s.addCustomSkill('code-review', '---\nname: code-review\n---\nReview.\n');
    const res = await s.export({ sign: false });
    const bundle = await unpack(fromBase64(res.bytesBase64));
    expect(validateBundle(bundle).ok).toBe(true);
  });

  it('installs the current brain into a framework via an adapter', async () => {
    const s = new StudioSession();
    s.setMeta({ name: 'demo' });
    s.setPersona('# Persona\nAtlas.\n');
    s.addMcpFromCatalog('github');
    s.addCustomSkill('code-review', '---\nname: code-review\n---\nReview.\n');
    const root = mkdtempSync(join(tmpdir(), 'uniqent-studio-inst-'));
    try {
      const plan = await s.installPlan('claude-code', root);
      expect(plan.requiresCredentials).toContain('github_pat');
      const res = await s.install('claude-code', root, { github_pat: 'ghp_demo000111222333444' });
      expect(res.written.length).toBeGreaterThan(0);
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('signed export verifies', async () => {
    const s = new StudioSession();
    s.setMeta({ name: 'demo' });
    s.setPersona('# Persona\n');
    s.addMcpFromCatalog('github');
    s.addCustomSkill('code-review', '---\nname: code-review\n---\nReview.\n');
    const res = await s.export({ sign: true });
    expect(res.signed).toBe(true);
    expect(res.verified).toBe(true);
    const bundle = await unpack(fromBase64(res.bytesBase64));
    expect((await verify(bundle)).valid).toBe(true);
  });
});
