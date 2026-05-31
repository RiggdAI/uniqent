import { describe, it, expect } from 'vitest';
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
    s.addSkillFromCatalog('code-review');
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

  it('removes mcp servers and skills', () => {
    const s = new StudioSession();
    s.addMcpFromCatalog('github');
    s.addSkillFromCatalog('code-review');
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
    s.addSkillFromCatalog('code-review');
    const res = await s.export({ sign: false });
    const bundle = await unpack(fromBase64(res.bytesBase64));
    expect(validateBundle(bundle).ok).toBe(true);
  });

  it('signed export verifies', async () => {
    const s = new StudioSession();
    s.setMeta({ name: 'demo' });
    s.setPersona('# Persona\n');
    s.addMcpFromCatalog('github');
    s.addSkillFromCatalog('code-review');
    const res = await s.export({ sign: true });
    expect(res.signed).toBe(true);
    expect(res.verified).toBe(true);
    const bundle = await unpack(fromBase64(res.bytesBase64));
    expect((await verify(bundle)).valid).toBe(true);
  });
});
