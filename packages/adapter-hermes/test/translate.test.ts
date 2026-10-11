import { describe, it, expect } from 'vitest';
import { Brain } from '@uniqent/builder';
import { hermesPure, MissingCredentialError } from '../src/pure';

const META = {
  name: 'dev',
  displayName: 'Dev',
  version: '0.1.0',
  description: 'd',
  author: { name: 'me' },
  license: 'CC0-1.0',
  tags: [],
};

function makeBundle() {
  const b = Brain.create(META);
  b.setPersona('# Persona\nHermes agent.');
  b.addMcpFromCatalog('github');
  b.addSkill('triage', '---\nname: triage\n---\nTriage.\n');
  b.addChannelFromCatalog('telegram');
  b.addMemory({ id: 'm1', kind: 'fact', text: 'a fact', createdAt: '2026-05-31T00:00:00.000Z' });
  return b.toBundle();
}

const bundle = makeBundle();
const resolved = { github_pat: 'ghp_demo000111222333444', telegram_bot_token: 'bot:secrettoken' };
const ctx = { root: '/h', home: '/home/u', cwd: '/home/u' };
const enc = new TextEncoder();
const read = new Map([
  ['/h/config.yaml', enc.encode('# keep me\nmodel: x\n')],
  ['/h/.env', enc.encode('EXISTING=1\n')],
]);

describe('hermesPure (no disk)', () => {
  it('asks for the five HERMES_HOME files plus every bundle skill target, nothing else', () => {
    expect(hermesPure.inputs(bundle, new Map(), ctx).files.map((f) => f.path)).toEqual([
      'SOUL.md',
      'memories/MEMORY.md',
      'memories/USER.md',
      'config.yaml',
      '.env',
      ...bundle.list().filter((p) => p.startsWith('skills/')),
    ]);
  });

  it('reports replacing an existing, different skill file', () => {
    const skill = bundle.list().find((p) => p.startsWith('skills/'))!;
    const withSkill = new Map([...read, [`/h/${skill}`, enc.encode('my own skill\n')]]);
    expect(hermesPure.plan(bundle, withSkill, ctx).lossiness).toContainEqual({
      component: `skill ${skill}`,
      action: 'transformed',
      issue: 'replaces an existing, different skill file.',
    });
  });

  it('writes .env owner-only with the resolved value and keeps other lines', () => {
    const t = hermesPure.translate(bundle, read, resolved, ctx);
    const env = t.writes.find((w) => w.path === '.env');
    expect(env?.mode).toBe(0o600);
    expect(new TextDecoder().decode(env?.bytes)).toMatch(/^EXISTING=1\n/);
    expect(t.writes.filter((w) => w.path !== '.env').every((w) => w.mode === null)).toBe(true);
  });

  it('refuses to translate without every required credential', () => {
    expect(() => hermesPure.translate(bundle, read, {}, ctx)).toThrow(MissingCredentialError);
  });

  it('captures nested skills, stopping at the first SKILL.md', () => {
    const files = new Map([
      ['/h/skills/a/SKILL.md', enc.encode('---\nname: a\n---\n')],
      ['/h/skills/a/inner/SKILL.md', enc.encode('ignored')],
      ['/h/skills/group/b/SKILL.md', enc.encode('---\nname: b\n---\n')],
    ]);
    expect(hermesPure.capture(files, ctx).skillNames().sort()).toEqual(['a', 'b']);
  });
});
