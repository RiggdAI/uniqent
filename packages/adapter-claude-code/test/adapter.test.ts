import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '@uniqent/builder';
import { validateBundle, scanForSecrets } from '@uniqent/core';
import type { Bundle } from '@uniqent/core';
import { runConformance, PathEscapeError, type InstallPlan } from '@uniqent/adapter-sdk';
import { claudeCodeAdapter, CredentialScopeError, McpConfigParseError } from '../src/index';

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
    text: 'prefers [[TypeScript]] and [[pnpm]] #conventions', // Obsidian markup must be stripped on render
    createdAt: '2026-05-31T00:00:00.000Z',
  });
  b.addMcpFromCatalog('github');
  b.addSkill('code-review', '---\nname: code-review\n---\nReview code.\n');
  b.addChannelFromCatalog('telegram'); // dropped by Claude Code → exercises lossiness
  return b.toBundle();
}

function emptyBrain() {
  return Brain.create({
    name: 'bare',
    displayName: 'Bare',
    version: '0.1.0',
    description: 'd',
    author: { name: 'me' },
    license: 'CC0-1.0',
    tags: [],
  });
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
      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('Atlas');
      // Obsidian wiki/tag syntax must NOT leak into the installed memory.
      expect(agents).toContain('prefers TypeScript and pnpm');
      expect(agents).not.toContain('[[');
      expect(agents).not.toContain('#conventions');
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

  it('recovers the credential requirement on capture WITHOUT leaking its value', async () => {
    const root = tmp();
    try {
      writeFileSync(join(root, 'AGENTS.md'), '# Persona\nCaptured Atlas.');
      mkdirSync(join(root, '.claude', 'skills', 'code-review'), { recursive: true });
      writeFileSync(
        join(root, '.claude', 'skills', 'code-review', 'SKILL.md'),
        '---\nname: code-review\n---\nReview.\n',
      );
      writeFileSync(
        join(root, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            github: {
              type: 'http',
              url: 'https://api.githubcopilot.com/mcp/',
              headers: { Authorization: 'Bearer ghp_SECRET123456789abcdefghij' },
            },
            fs: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
          },
        }),
      );

      const bundle = await claudeCodeAdapter.export({ root });
      const cred = bundle.manifest().credentials.find((c) => c.ref === 'github_token');
      expect(cred?.type).toBe('bearer'); // requirement recovered → captured brain stays functional
      expect(cred?.consumedBy).toContain('mcp:github');
      expect(validateBundle(bundle).ok).toBe(true);
      expect(scanForSecrets(bundle)).toHaveLength(0); // value scrubbed → scan clean
      for (const path of bundle.list()) {
        const bytes = bundle.get(path);
        if (bytes) expect(new TextDecoder().decode(bytes)).not.toContain('ghp_SECRET');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('claudeCodeAdapter hardening', () => {
  const emptyPlan: InstallPlan = {
    writes: [],
    mcpRegistrations: [],
    channelRegistrations: [],
    lossiness: [],
    requiresCredentials: [],
  };
  const creds = { github_pat: 'ghp_demo000111222333444555666' };

  it('rejects a skill path that escapes the skills dir, before writing anything', async () => {
    const root = tmp();
    try {
      // core's Bundle refuses '..' paths, so simulate a hostile bundle that slipped past it.
      const real = makeBundle();
      const evil = 'skills/x/../../../evil.md';
      const bundle = Object.assign(Object.create(real) as Bundle, {
        list: () => [...real.list(), evil],
        get: (p: string) => (p === evil ? new TextEncoder().encode('pwned') : real.get(p)),
      });
      await expect(claudeCodeAdapter.plan(bundle, { root })).rejects.toBeInstanceOf(
        PathEscapeError,
      );
      await expect(claudeCodeAdapter.apply(bundle, emptyPlan, creds, { root })).rejects.toThrow(
        PathEscapeError,
      );
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
      expect(existsSync(join(root, '..', 'evil.md'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves user AGENTS.md content and imports AGENTS.md from an existing CLAUDE.md', async () => {
    const root = tmp();
    try {
      writeFileSync(join(root, 'AGENTS.md'), '# My notes\nkeep me\n');
      writeFileSync(join(root, 'CLAUDE.md'), '# Project rules\nuse tabs\n');
      const bundle = makeBundle();
      const plan = await claudeCodeAdapter.plan(bundle, { root });
      const byPath = new Map(plan.writes.map((w) => [w.path, w.summary]));
      expect(byPath.get('AGENTS.md')).toMatch(/^modify existing/);
      expect(byPath.get('CLAUDE.md')).toMatch(/^modify existing/);

      await claudeCodeAdapter.apply(bundle, plan, creds, { root });
      await claudeCodeAdapter.apply(bundle, plan, creds, { root });
      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(agents.startsWith('# My notes\nkeep me\n')).toBe(true);
      expect(agents.split('Atlas').length - 1).toBe(1);
      const claude = readFileSync(join(root, 'CLAUDE.md'), 'utf8');
      expect(claude.startsWith('# Project rules\nuse tabs\n')).toBe(true);
      expect(claude.split('@AGENTS.md').length - 1).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes facts + profile without a persona, into a root that does not exist yet', async () => {
    const parent = tmp();
    const root = join(parent, 'nested', 'fresh');
    try {
      const b = emptyBrain();
      b.addMemory({
        id: 'f1',
        kind: 'fact',
        text: 'deploys on Fridays',
        createdAt: '2026-05-31T00:00:00.000Z',
      });
      b.setProfile({ role: 'staff engineer' });
      const bundle = b.toBundle();
      const plan = await claudeCodeAdapter.plan(bundle, { root });
      expect(plan.writes.map((w) => w.path)).toEqual(['AGENTS.md']);
      await claudeCodeAdapter.apply(bundle, plan, {}, { root });
      const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
      expect(agents).toContain('deploys on Fridays');
      expect(agents).toContain('role: staff engineer');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it('reports episodic memory, runtime config and tool allowlists as lossiness', async () => {
    const b = emptyBrain();
    b.addMemory({
      id: 'e1',
      kind: 'episodic',
      text: 'met Bob',
      createdAt: '2026-05-31T00:00:00.000Z',
    });
    b.setRuntime({ model: { name: 'opus' } });
    b.addMcpServer({
      id: 'fs',
      transport: 'stdio',
      command: 'npx',
      auth: { type: 'none' },
      tools: { include: ['read_file'] },
    });
    const plan = await claudeCodeAdapter.plan(b.toBundle(), { root: '/tmp/x' });
    expect(plan.lossiness.map((l) => l.component)).toEqual(
      expect.arrayContaining(['memory (episodic)', 'runtime', 'mcp:fs tools']),
    );
  });

  it('throws on an unparseable .mcp.json instead of wiping it', async () => {
    const root = tmp();
    try {
      const original = '{\n  // my servers\n  "mcpServers": {}\n}\n';
      writeFileSync(join(root, '.mcp.json'), original);
      const bundle = makeBundle();
      await expect(claudeCodeAdapter.plan(bundle, { root })).rejects.toBeInstanceOf(
        McpConfigParseError,
      );
      await expect(claudeCodeAdapter.apply(bundle, emptyPlan, creds, { root })).rejects.toThrow(
        McpConfigParseError,
      );
      expect(readFileSync(join(root, '.mcp.json'), 'utf8')).toBe(original);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('surfaces a server-id collision with a different config and keeps other entries', async () => {
    const root = tmp();
    try {
      writeFileSync(
        join(root, '.mcp.json'),
        JSON.stringify({
          mcpServers: { github: { command: 'my-gh' }, mine: { command: 'mine' } },
        }),
      );
      const bundle = makeBundle();
      const plan = await claudeCodeAdapter.plan(bundle, { root });
      expect(plan.writes.find((w) => w.path === '.mcp.json')?.summary).toContain(
        'replacing your entries: github',
      );
      expect(plan.lossiness).toContainEqual(
        expect.objectContaining({ component: 'mcp:github', action: 'transformed' }),
      );
      await claudeCodeAdapter.apply(bundle, plan, creds, { root });
      const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
      expect(mcp.mcpServers.mine).toEqual({ command: 'mine' });
      // Re-planning against our own entry is not a collision.
      const again = await claudeCodeAdapter.plan(bundle, { root });
      expect(again.lossiness.map((l) => l.component)).not.toContain('mcp:github');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('injects a credential only into servers listed in its consumedBy', async () => {
    const b = emptyBrain();
    b.addMcpFromCatalog('github');
    b.addMcpServer({
      id: 'other',
      transport: 'stdio',
      command: 'other-mcp',
      env: { TOKEN: '${credentialRef:github_pat}' },
      auth: { type: 'none' },
      tools: { include: 'all' },
    });
    // The builder attributes placeholder users to consumedBy, so hand-narrow the manifest to
    // simulate a bundle that declares the credential for `github` only.
    const bundle = b.toBundle();
    const manifest = bundle.manifest();
    bundle.set(
      'uniqent.json',
      JSON.stringify({
        ...manifest,
        credentials: manifest.credentials.map((c) =>
          c.ref === 'github_pat' ? { ...c, consumedBy: ['mcp:github'] } : c,
        ),
      }),
    );
    await expect(claudeCodeAdapter.plan(bundle, { root: '/tmp/x' })).rejects.toBeInstanceOf(
      CredentialScopeError,
    );
  });

  it('writes .mcp.json with mode 0600 when it inlines credentials, and says so', async () => {
    const root = tmp();
    try {
      writeFileSync(join(root, '.mcp.json'), '{}');
      chmodSync(join(root, '.mcp.json'), 0o644);
      const bundle = makeBundle();
      const plan = await claudeCodeAdapter.plan(bundle, { root });
      const result = await claudeCodeAdapter.apply(bundle, plan, creds, { root });
      expect(statSync(join(root, '.mcp.json')).mode & 0o777).toBe(0o600);
      expect(result.notes.join('\n')).toContain('do not commit');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('exports stdio env as credential requirements and reads persona from CLAUDE.md', async () => {
    const root = tmp();
    try {
      writeFileSync(join(root, 'CLAUDE.md'), '# Rules\nBe terse.\n');
      writeFileSync(
        join(root, '.mcp.json'),
        JSON.stringify({
          mcpServers: {
            fs: {
              command: 'npx',
              env: { API_KEY: 'sk-SECRETabcdefghijklmnopqrstuv0123', LOG_LEVEL: 'debug' },
            },
          },
        }),
      );
      const bundle = await claudeCodeAdapter.export({ root });
      expect(bundle.persona()).toContain('Be terse.');
      const fs = bundle.mcpServers().find((s) => s.id === 'fs');
      expect(fs?.env).toEqual({ API_KEY: '${credentialRef:fs_api_key}', LOG_LEVEL: 'debug' });
      const cred = bundle.manifest().credentials.find((c) => c.ref === 'fs_api_key');
      expect(cred?.consumedBy).toEqual(['mcp:fs']);
      expect(scanForSecrets(bundle)).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects a Claude Code project only when .claude/ or .mcp.json exists', async () => {
    const root = tmp();
    try {
      expect((await claudeCodeAdapter.detect({ root })).present).toBe(false);
      mkdirSync(join(root, '.claude'));
      expect((await claudeCodeAdapter.detect({ root })).present).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
