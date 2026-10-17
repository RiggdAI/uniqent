import { describe, it, expect } from 'vitest';
import { importVault, parseProfile, type VaultFile } from '../src/memory/vault';

const vault: VaultFile[] = [
  { path: 'SOUL.md', content: '# Soul\nYou are a calm, precise engineering assistant.\n' },
  {
    path: 'USER.md',
    content: '# Me\n**Name:** Max\n- Role: founder\nLocation:: Berlin\nI like long walks.\n',
  },
  {
    path: 'MEMORY.md',
    content:
      '# Memory\n- Decision: standardized on [[Postgres]] over [[Mongo]] #database\n- prefers [[TypeScript]] strict mode #conventions\n',
  },
  {
    path: 'notes/architecture.md',
    content: '# Arch\n[[Auth-Service]] owns sessions #architecture\n',
  },
  { path: 'daily/2026-06-01.md', content: '# Mon\nshipped the billing rewrite #milestone\n' },
  { path: '.obsidian/workspace.json', content: '{}' }, // ignored (not .md, but guard anyway)
];

describe('importVault', () => {
  it('maps SOUL.md → persona', () => {
    const out = importVault(vault);
    expect(out.persona).toContain('calm, precise');
    expect(out.stats.personaFrom).toBe('SOUL.md');
  });

  it('maps USER.md → a key/value profile, prose under notes', () => {
    const out = importVault(vault);
    expect(out.profile).toMatchObject({ Name: 'Max', Role: 'founder', Location: 'Berlin' });
    expect(out.profile?.notes).toContain('long walks');
  });

  it('turns MEMORY.md + notes into memory items with provenance + preserved markup', () => {
    const out = importVault(vault);
    const decision = out.items.find((i) => i.kind === 'decision');
    expect(decision?.text).toContain('[[Postgres]]'); // wikilinks kept inline
    expect(decision?.entities).toEqual(expect.arrayContaining(['Postgres', 'Mongo']));
    const arch = out.items.find((i) => i.source === 'notes/architecture.md');
    expect(arch?.text).toContain('[[Auth-Service]]');
  });

  it('forces journal/dated notes to episodic (scrubbed on export)', () => {
    const out = importVault(vault);
    const daily = out.items.find((i) => i.source === 'daily/2026-06-01.md');
    expect(daily?.kind).toBe('episodic');
    expect(out.stats.episodic).toBe(1);
  });

  it('does not double-consume the persona/profile files as memory', () => {
    const out = importVault(vault);
    expect(out.items.some((i) => i.source === 'SOUL.md')).toBe(false);
    expect(out.items.some((i) => i.source === 'USER.md')).toBe(false);
  });

  it('falls back to AGENTS.md for persona when no SOUL.md', () => {
    const out = importVault([{ path: 'AGENTS.md', content: 'Be terse.\n' }]);
    expect(out.persona).toBe('Be terse.');
    expect(out.stats.personaFrom).toBe('AGENTS.md');
  });

  it('takes persona/profile only from the vault root; nested ones are ordinary notes', () => {
    const out = importVault([
      { path: 'projects/webapp/CLAUDE.md', content: '# Webapp\nRun pnpm test before commit.\n' },
      { path: 'archive/USER.md', content: 'Name: Old Me' },
      { path: 'USER.md', content: 'Name: Max' },
    ]);
    expect(out.persona).toBeUndefined();
    expect(out.profile).toEqual({ Name: 'Max' });
    expect(out.stats.profileFrom).toBe('USER.md');
    expect(out.items.map((i) => i.source).sort()).toEqual([
      'archive/USER.md',
      'projects/webapp/CLAUDE.md',
    ]);
  });
});

describe('parseProfile', () => {
  it('returns empty for prose-only with a single notes field', () => {
    const p = parseProfile('just some freeform text about me');
    expect(p.notes).toBe('just some freeform text about me');
  });

  it('keeps repeated keys, explicit notes + prose, URLs, and never truncates', () => {
    const bio = 'x'.repeat(500);
    const p = parseProfile(
      [
        'notes: from key',
        'Some free prose that should survive.',
        'Project: A',
        'Project: B',
        'Website: https://maxlibin.com',
        'https://github.com/foo',
        `Bio: ${bio}`,
      ].join('\n'),
    );
    expect(p).toEqual({
      notes: 'from key; Some free prose that should survive. https://github.com/foo',
      Project: 'A; B',
      Website: 'https://maxlibin.com',
      Bio: bio,
    });
  });
});
