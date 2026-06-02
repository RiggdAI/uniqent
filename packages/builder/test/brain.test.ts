import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain';
import { validateBundle, canonicalDigest, scanForSecrets } from '@uniqent/core';

function baseMeta() {
  return {
    name: 'demo',
    displayName: 'Demo',
    version: '0.1.0',
    description: 'demo brain',
    author: { name: 'Me' },
    license: 'CC0-1.0',
    tags: ['demo'],
  };
}

describe('Brain', () => {
  it('assembles a valid bundle from scratch + catalog', () => {
    const b = Brain.create(baseMeta());
    b.setPersona('# Persona\nHelpful.\n');
    b.addMemory({
      id: 'f1',
      kind: 'fact',
      text: 'prefers TS',
      createdAt: '2026-05-31T00:00:00.000Z',
    });
    b.addMcpFromCatalog('github');
    b.addSkill('code-review', '---\nname: code-review\n---\nReview code.\n');
    const result = validateBundle(b.toBundle());
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('catalog MCP adds its credential and consumedBy is synced', () => {
    const b = Brain.create(baseMeta());
    b.addMcpFromCatalog('github');
    const m = b.toBundle().manifest();
    const cred = m.credentials.find((c) => c.ref === 'github_pat');
    expect(cred).toBeDefined();
    expect(cred?.consumedBy).toContain('mcp:github');
  });

  it('routes episodic memory to episodic and others to facts', () => {
    const b = Brain.create(baseMeta());
    b.addMemory({
      id: 'e1',
      kind: 'episodic',
      text: 'said hi',
      createdAt: '2026-05-31T00:00:00.000Z',
    });
    b.addMemory({ id: 'f1', kind: 'fact', text: 'x', createdAt: '2026-05-31T00:00:00.000Z' });
    const bundle = b.toBundle();
    expect(bundle.memoryEpisodic()).toHaveLength(1);
    expect(bundle.memoryFacts()).toHaveLength(1);
  });

  it('derives components and stdio process-spawn permission', () => {
    const b = Brain.create(baseMeta());
    b.addMcpFromCatalog('filesystem');
    const m = b.toBundle().manifest();
    expect(m.components.mcp).toContain('filesystem');
    expect(m.permissions.spawnsProcesses).toBe(true);
  });

  it('round-trips: fromBundle(toBundle) is digest-stable', () => {
    const b = Brain.create(baseMeta());
    b.setPersona('# Persona\nHi.\n');
    b.addMemory({ id: 'f1', kind: 'fact', text: 'x', createdAt: '2026-05-31T00:00:00.000Z' });
    b.addMcpFromCatalog('github');
    b.addSkill('summarize', '---\nname: summarize\n---\nSummarize text.\n');
    const first = b.toBundle();
    const round = Brain.fromBundle(first).toBundle();
    expect(canonicalDigest(round)).toBe(canonicalDigest(first));
  });

  it('carries a README ("about this brain") into the bundle and back', () => {
    const b = Brain.create(baseMeta());
    b.setPersona('# Persona\nHi.\n');
    b.setReadme('# Acme\nA coding agent for **TypeScript** repos.\n');
    const bundle = b.toBundle();
    expect(bundle.readme()).toContain('A coding agent');
    // round-trips through fromBundle and is part of the signed digest (same file set)
    const round = Brain.fromBundle(bundle);
    expect(round.getReadme()).toBe('# Acme\nA coding agent for **TypeScript** repos.\n');
    expect(canonicalDigest(round.toBundle())).toBe(canonicalDigest(bundle));
    // empty/blank readme clears it (no README.md file)
    b.setReadme('   ');
    expect(b.toBundle().readme()).toBeUndefined();
  });

  it('carries an avatar image without tripping the secret scan, and round-trips', () => {
    const b = Brain.create(baseMeta());
    b.setPersona('# Persona\nHi.\n');
    // High-entropy bytes (as a real PNG would be) that WOULD false-positive the entropy
    // detector if the scanner didn't skip binary assets.
    const bytes = new Uint8Array(2048);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 167 + 13) % 256;
    b.setAvatar('png', bytes);
    const bundle = b.toBundle();
    expect(bundle.avatar()?.path).toBe('avatar.png');
    expect(scanForSecrets(bundle)).toEqual([]); // image bytes are skipped, no false positive
    // round-trips through fromBundle and is part of the signed digest
    const round = Brain.fromBundle(bundle);
    expect(round.getAvatar()?.bytes).toEqual(bytes);
    expect(canonicalDigest(round.toBundle())).toBe(canonicalDigest(bundle));
    // jpeg normalizes to .jpg; unknown types rejected
    b.setAvatar('jpeg', bytes);
    expect(b.toBundle().avatar()?.path).toBe('avatar.jpg');
    expect(() => b.setAvatar('exe', bytes)).toThrow(/unsupported avatar/);
  });
});
