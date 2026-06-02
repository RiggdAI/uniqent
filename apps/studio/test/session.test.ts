import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
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

  it('searches MCP hubs and adds a discovered server with its credential', async () => {
    const s = new StudioSession();
    s.setMeta({ name: 'demo' });
    s.setPersona('# Persona\n');
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('registry.modelcontextprotocol.io')) {
        return new Response(
          JSON.stringify({
            servers: [
              {
                server: {
                  name: 'io.example/secrets',
                  description: 'needs a key',
                  packages: [
                    {
                      registryType: 'npm',
                      identifier: 'secrets-mcp',
                      runtimeHint: 'npx',
                      transport: { type: 'stdio' },
                      environmentVariables: [{ name: 'API_KEY', isSecret: true }],
                    },
                  ],
                },
                _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
              },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({ servers: [] })); // smithery: empty
    }) as typeof fetch;
    try {
      const { results } = await s.searchHubMcp('secrets');
      const hit = results.find((r) => r.entry.id === 'io-example-secrets');
      expect(hit).toBeTruthy();
      s.addMcpHubResult(hit!);
      const m = s.state().manifest;
      expect(m.components.mcp).toContain('io-example-secrets');
      expect(m.credentials.find((c) => c.ref === 'io-example-secrets_api_key')).toBeTruthy();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('stores custom hub index URLs (http(s) only) and uses them in searches', async () => {
    const s = new StudioSession();
    expect(s.setHubIndexUrls(['https://team/hub.json', 'notaurl', ' https://b/i.json '])).toEqual([
      'https://team/hub.json',
      'https://b/i.json',
    ]);
    expect(s.listHubIndexUrls()).toHaveLength(2);

    const orig = globalThis.fetch;
    const hit: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      hit.push(url);
      if (url.startsWith('https://team/hub.json')) {
        return new Response(
          JSON.stringify({
            mcp: [
              {
                id: 'teamdb',
                name: 'Team DB',
                description: 'internal db',
                server: {
                  id: 'teamdb',
                  transport: 'stdio',
                  command: 'npx',
                  auth: { type: 'none' },
                  tools: { include: 'all' },
                },
              },
            ],
          }),
        );
      }
      return new Response(JSON.stringify({ servers: [] })); // registry + smithery empty
    }) as typeof fetch;
    try {
      const { results } = await s.searchHubMcp('team');
      expect(hit.some((u) => u.startsWith('https://team/hub.json'))).toBe(true);
      expect(results.find((r) => r.entry.id === 'teamdb')).toBeTruthy();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('sets a profile (drops blanks), reflects hasProfile, and clears when empty', () => {
    const s = new StudioSession();
    s.setProfile({ Role: ' Staff engineer ', About: '', '': 'ignored', Team: 'Platform' });
    expect(s.getProfile()).toEqual({ Role: 'Staff engineer', Team: 'Platform' });
    expect(s.state().manifest.components.memory.hasProfile).toBe(true);
    // A profile with no usable fields clears it.
    s.setProfile({ About: '   ' });
    expect(s.getProfile()).toEqual({});
    expect(s.state().manifest.components.memory.hasProfile).toBe(false);
  });

  it('a brain with a profile exports a USER profile that survives a round-trip', async () => {
    const s = new StudioSession();
    s.setMeta({ name: 'demo' });
    s.setPersona('# Persona\n');
    s.addMcpFromCatalog('github');
    s.addCustomSkill('code-review', '---\nname: code-review\n---\nReview.\n');
    s.setProfile({ Role: 'Founding engineer', 'Working style': 'ships small PRs' });
    const res = await s.export({ sign: false });
    const bundle = await unpack(fromBase64(res.bytesBase64));
    expect(validateBundle(bundle).ok).toBe(true);
    expect(bundle.memoryProfile()).toEqual({
      Role: 'Founding engineer',
      'Working style': 'ships small PRs',
    });
  });

  it('smart-imports markdown into kinded memory and builds the brain graph', () => {
    const s = new StudioSession();
    const n = s.importMarkdown(
      [
        '# Context',
        '- Decision: standardized on [[Postgres]] #database',
        '- The user prefers [[TypeScript]] #conventions',
        '[[Postgres]] is tuned for OLTP #database',
      ].join('\n'),
    );
    expect(n).toBe(3);
    const m = s.state().manifest.components.memory;
    expect(m.facts).toBe(3);
    const g = s.memoryGraph();
    // 3 memory + Postgres/TypeScript entities + database/conventions tags.
    expect(g.nodes.filter((x) => x.type === 'memory')).toHaveLength(3);
    const pg = g.nodes.find((x) => x.id === 'ent:postgres');
    expect(pg?.degree).toBe(2); // shared across two facts
  });

  it('previews a markdown import without adding it', () => {
    const s = new StudioSession();
    const { items, graph } = s.previewMemoryImport('- Decision: use [[Redis]] #cache');
    expect(items[0]?.kind).toBe('decision');
    expect(graph.nodes.some((n) => n.id === 'ent:redis')).toBe(true);
    expect(s.state().manifest.components.memory.facts).toBe(0); // not added
  });

  it('searches the memory hub and pulls a pack into the brain (kinds preserved)', async () => {
    const s = new StudioSession();
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (/\/api\/v1\/memory\/[^?]/.test(url)) {
        return new Response(
          JSON.stringify({
            facts: [
              { kind: 'decision', text: 'use [[Postgres]] #db' },
              { kind: 'fact', text: 'tune it for OLTP' },
            ],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          packs: [
            {
              slug: 'platform',
              name: 'Platform',
              description: 'd',
              tags: ['db'],
              factCount: 2,
              url: 'https://x/p.json',
            },
          ],
        }),
      );
    }) as typeof fetch;
    try {
      const r = await s.searchMemoryHub('db', 'https://reg');
      expect(r.results[0]?.slug).toBe('platform');
      expect(r.results[0]?.factCount).toBe(2);
      const n = await s.addMemoryPack('platform', 'https://reg');
      expect(n).toBe(2);
      expect(s.state().manifest.components.memory.facts).toBe(2);
    } finally {
      globalThis.fetch = orig;
    }
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

  it('refuses to install an invalid brain', async () => {
    const s = new StudioSession();
    s.setMeta({ name: 'Not A Slug' }); // invalid manifest name → validation fails
    const root = mkdtempSync(join(tmpdir(), 'uniqent-inv-'));
    try {
      await expect(s.install('claude-code', root, {})).rejects.toThrow(/invalid/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('imports a second-brain vault from a folder (persona/profile/memory + episodic + skips)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'uniqent-vault-'));
    try {
      mkdirSync(join(root, 'notes'));
      mkdirSync(join(root, 'daily'));
      mkdirSync(join(root, '.obsidian'));
      writeFileSync(join(root, 'SOUL.md'), '# Soul\nCalm precise engineer.\n');
      writeFileSync(join(root, 'USER.md'), '**Name:** Max\n- Role: founder\n');
      writeFileSync(
        join(root, 'MEMORY.md'),
        '- Decision: chose [[Postgres]] #db\n- likes [[pnpm]]\n',
      );
      writeFileSync(join(root, 'notes', 'arch.md'), '[[Auth-Service]] owns sessions #arch\n');
      writeFileSync(join(root, 'daily', '2026-06-01.md'), 'shipped [[Billing]] #milestone\n');
      writeFileSync(join(root, '.obsidian', 'workspace.json'), '{}'); // must be skipped

      const s = new StudioSession();
      s.setMeta({ name: 'demo' });

      const pv = await s.previewVault(root);
      expect(pv.result.stats).toMatchObject({ memoryFiles: 3, items: 4, episodic: 1 });

      const stats = await s.importVaultDir(root);
      expect(stats.personaFrom).toBe('SOUL.md');
      expect(stats.profileFrom).toBe('USER.md');

      const c = s.state().manifest.components;
      expect(c.identity).toBe(true); // persona set
      expect(c.memory.facts).toBe(3);
      expect(c.memory.episodic).toBe(1); // the dated daily note
      expect(c.memory.hasProfile).toBe(true);
      expect(s.getProfile()).toMatchObject({ Name: 'Max', Role: 'founder' });
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
