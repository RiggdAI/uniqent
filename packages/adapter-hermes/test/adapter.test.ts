import { describe, it, expect } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '@uniqent/builder';
import { validateBundle } from '@uniqent/core';
import { CredentialScopeError, PathEscapeError, runConformance } from '@uniqent/adapter-sdk';
import { claudeCodeAdapter } from '@uniqent/adapter-claude-code';
import { hermesAdapter, skillTarget } from '../src/index';
import { ENTRY_DELIMITER, MEMORY_MAX } from '../src/memory';

const META = {
  name: 'dev',
  displayName: 'Dev',
  version: '0.1.0',
  description: 'd',
  author: { name: 'me' },
  license: 'CC0-1.0',
  tags: [],
};
const AT = '2026-05-31T00:00:00.000Z';

function makeBrain(fillerFacts: number) {
  const b = Brain.create(META);
  b.setPersona('# Persona\nHermes agent.');
  b.addMcpFromCatalog('github');
  b.addSkill('triage', '---\nname: triage\n---\nTriage.\n');
  b.addChannelFromCatalog('telegram');
  b.addMemory({
    id: 'keep',
    kind: 'fact',
    text: 'KEEP-ME-high-importance',
    createdAt: AT,
    importance: 1,
  });
  for (let i = 0; i < fillerFacts; i++) {
    b.addMemory({
      id: `d${i}`,
      kind: 'fact',
      text: `low importance filler fact number ${i} ${'x'.repeat(30)}`,
      createdAt: AT,
      importance: 0,
    });
  }
  return b;
}

const makeBundle = () => makeBrain(60).toBundle();

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'uniqent-hermes-'));
}

async function install(
  root: string,
  bundle: ReturnType<typeof makeBundle>,
  resolved: Record<string, string>,
) {
  const plan = await hermesAdapter.plan(bundle, { root });
  await hermesAdapter.apply(bundle, plan, resolved, { root });
  return plan;
}

const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');
const RESOLVED = { github_pat: 'ghp_demo000111222333444', telegram_bot_token: 'bot:secrettoken' };

describe('hermesAdapter.plan', () => {
  it('reports memory truncation and requires mcp+channel credentials', async () => {
    const plan = await hermesAdapter.plan(makeBundle(), {
      root: join(tmpdir(), 'uniqent-hermes-absent'),
    });
    expect(plan.lossiness.some((l) => l.component === 'memory' && l.action === 'truncated')).toBe(
      true,
    );
    expect(plan.requiresCredentials).toEqual(
      expect.arrayContaining(['github_pat', 'telegram_bot_token']),
    );
    expect(plan.channelRegistrations).toEqual(['telegram']);
  });
});

describe('hermesAdapter.apply', () => {
  it('writes the real HERMES_HOME layout and keeps secrets only in a 0600 .env', async () => {
    const root = tmp();
    try {
      await install(root, makeBundle(), RESOLVED);

      expect(existsSync(join(root, 'SOUL.md'))).toBe(true);
      expect(existsSync(join(root, 'skills/triage/SKILL.md'))).toBe(true);
      const memory = read(root, 'memories/MEMORY.md');
      expect(memory.length).toBeLessThanOrEqual(MEMORY_MAX);
      expect(memory.startsWith('KEEP-ME-high-importance' + ENTRY_DELIMITER)).toBe(true); // no header
      expect(memory).not.toContain('# Memory');

      const config = read(root, 'config.yaml');
      expect(config).toContain('mcp_servers:');
      expect(config).toContain('Bearer ${GITHUB_PAT}');
      expect(config).not.toContain('ghp_demo000111222333444');

      const env = read(root, '.env');
      expect(env).toContain('GITHUB_PAT=ghp_demo000111222333444');
      expect(env).toContain('TELEGRAM_BOT_TOKEN=bot:secrettoken'); // gateway/config.py reads this
      expect(statSync(join(root, '.env')).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips an oversized high-importance fact but keeps filling, and reports it', async () => {
    const root = tmp();
    try {
      const b = makeBrain(3);
      b.addMemory({
        id: 'huge',
        kind: 'fact',
        text: 'y'.repeat(MEMORY_MAX + 1),
        createdAt: AT,
        importance: 1,
      });
      const plan = await install(root, b.toBundle(), RESOLVED);

      const entries = read(root, 'memories/MEMORY.md').split(ENTRY_DELIMITER);
      expect(entries).toHaveLength(4); // keep + 3 fillers
      expect(entries[0]).toBe('KEEP-ME-high-importance');
      const loss = plan.lossiness.find((l) => l.component === 'memory');
      expect(loss?.issue).toContain('1 of 5');
      expect(loss?.issue).toContain('huge (');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('merges into existing memories, .env and config.yaml without destroying user content', async () => {
    const root = tmp();
    try {
      mkdirSync(join(root, 'memories'));
      writeFileSync(
        join(root, 'memories/MEMORY.md'),
        `user wrote this${ENTRY_DELIMITER}KEEP-ME-high-importance`,
      );
      writeFileSync(
        join(root, '.env'),
        '# my keys\nOPENROUTER_API_KEY=sk-or-user\nGITHUB_PAT=old\n',
      );
      writeFileSync(
        join(root, 'config.yaml'),
        '# my hermes config\nmodel:\n  default: claude-sonnet # pinned\nmcp_servers:\n  time:\n    command: uvx\n',
      );
      await install(root, makeBrain(2).toBundle(), RESOLVED);
      const first = ['memories/MEMORY.md', '.env', 'config.yaml'].map((f) => read(root, f));

      const memory = first[0]?.split(ENTRY_DELIMITER) ?? [];
      expect(memory[0]).toBe('user wrote this');
      expect(memory.filter((e) => e === 'KEEP-ME-high-importance')).toHaveLength(1); // deduped

      expect(first[1]).toBe(
        '# my keys\nOPENROUTER_API_KEY=sk-or-user\nGITHUB_PAT=ghp_demo000111222333444\nTELEGRAM_BOT_TOKEN=bot:secrettoken\n',
      );

      expect(first[2]).toContain('# my hermes config');
      expect(first[2]).toContain('default: claude-sonnet # pinned');
      expect(first[2]).toContain('time:\n    command: uvx');
      expect(first[2]).toContain('github:');

      // Idempotent: a second apply is byte-identical.
      await install(root, makeBrain(2).toBundle(), RESOLVED);
      expect(['memories/MEMORY.md', '.env', 'config.yaml'].map((f) => read(root, f))).toEqual(
        first,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports replacing an existing, different MCP entry, skill and .env value — once', async () => {
    const root = tmp();
    try {
      writeFileSync(
        join(root, 'config.yaml'),
        'mcp_servers:\n  github:\n    url: https://other.example/mcp\n',
      );
      mkdirSync(join(root, 'skills/triage'), { recursive: true });
      writeFileSync(join(root, 'skills/triage/SKILL.md'), 'my own triage\n');
      writeFileSync(join(root, '.env'), 'GITHUB_PAT=old\n');
      const bundle = makeBrain(2).toBundle();
      const plan = await hermesAdapter.plan(bundle, { root });
      expect(plan.lossiness).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ component: 'mcp:github', action: 'transformed' }),
          expect.objectContaining({
            component: 'skill skills/triage/SKILL.md',
            action: 'transformed',
          }),
        ]),
      );
      const result = await hermesAdapter.apply(bundle, plan, RESOLVED, { root });
      expect(result.notes).toContain(
        'transformed: .env — replaces your existing, different value of GITHUB_PAT.',
      );

      const again = await hermesAdapter.plan(bundle, { root });
      expect(again.lossiness.filter((l) => l.action === 'transformed')).toEqual([]);
      const rerun = await hermesAdapter.apply(bundle, again, RESOLVED, { root });
      expect(rerun.notes.join('\n')).not.toContain('.env');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves ${credentialRef:…} in stdio env to a ${ENV} ref backed by .env', async () => {
    const root = tmp();
    try {
      const b = Brain.create(META);
      b.addMcpServer({
        id: 'search',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'search-mcp'],
        env: { SEARCH_API_KEY: '${credentialRef:search_key}', REGION: 'eu' },
        auth: { type: 'none' },
        tools: { include: ['query'] },
      });
      b.addCredential({
        ref: 'search_key',
        label: 'Search key',
        type: 'envVar',
        consumedBy: ['mcp:search'],
        required: true,
      });
      const plan = await install(root, b.toBundle(), { search_key: 'real-search-value' });
      expect(plan.requiresCredentials).toEqual(['search_key']);

      const config = read(root, 'config.yaml');
      expect(config).toContain('SEARCH_API_KEY: ${SEARCH_KEY}');
      expect(config).toContain('include:\n        - query');
      expect(config).not.toContain('credentialRef');
      expect(config).not.toContain('real-search-value');
      expect(read(root, '.env')).toBe('SEARCH_KEY=real-search-value\n');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a credential in an MCP server its consumedBy does not list', async () => {
    const b = Brain.create(META);
    b.addMcpFromCatalog('github');
    b.addMcpServer({
      id: 'other',
      transport: 'stdio',
      command: 'other-mcp',
      env: { TOKEN: '${credentialRef:github_pat}' },
      auth: { type: 'none' },
      tools: { include: 'all' },
    });
    // The builder attributes placeholder users to consumedBy, so hand-narrow the manifest.
    const bundle = b.toBundle();
    const manifest = bundle.manifest();
    bundle.set(
      'uniqent.json',
      JSON.stringify({
        ...manifest,
        credentials: manifest.credentials.map((c) => ({ ...c, consumedBy: ['mcp:github'] })),
      }),
    );
    await expect(hermesAdapter.plan(bundle, { root: tmpdir() })).rejects.toBeInstanceOf(
      CredentialScopeError,
    );
  });

  it('rejects a skill path that escapes skills/', () => {
    expect(() => skillTarget('/tmp/hermes-home', 'skills/x/../../../../etc')).toThrow(
      PathEscapeError,
    );
    expect(() => skillTarget('/tmp/hermes-home', 'skills/x/../../config.yaml')).toThrow(
      PathEscapeError,
    );
    expect(skillTarget('/tmp/hermes-home', 'skills/x/SKILL.md')).toBe(
      '/tmp/hermes-home/skills/x/SKILL.md',
    );
  });

  it('passes the conformance harness, declaring tasks/tools/episodic/runtime as lossiness', async () => {
    const root = tmp();
    try {
      const b = makeBrain(60);
      b.addTask({
        id: 'brief',
        name: 'Daily brief',
        trigger: { type: 'schedule', cron: '0 9 * * *' },
        action: { kind: 'prompt', prompt: 'Brief me.' },
        enabled: true,
      });
      b.addMemory({ id: 'e1', kind: 'episodic', text: 'yesterday', createdAt: AT });
      b.setTool({ id: 'web_search', enabled: true });
      b.setRuntime({ autonomy: 'suggest' });
      const bundle = b.toBundle();
      const r = await runConformance(hermesAdapter, bundle, root);
      expect(r.ok, JSON.stringify(r.checks)).toBe(true);
      const plan = await hermesAdapter.plan(bundle, { root });
      expect(plan.lossiness.map((l) => l.component)).toEqual(
        expect.arrayContaining(['task:brief', 'episodic memory', 'tools', 'runtime config']),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('hermesAdapter.detect', () => {
  it('probes the root for config.yaml / SOUL.md', async () => {
    const root = tmp();
    try {
      expect((await hermesAdapter.detect({ root })).present).toBe(false);
      writeFileSync(join(root, 'config.yaml'), 'model: {}\n');
      expect(await hermesAdapter.detect({ root })).toEqual({ present: true, configRoot: root });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('hermesAdapter.export', () => {
  it('captures SOUL.md, §-split memories, nested skills and MCP credential requirements', async () => {
    const root = tmp();
    try {
      await install(root, makeBrain(2).toBundle(), RESOLVED);
      mkdirSync(join(root, 'skills/apple/imessage'), { recursive: true });
      writeFileSync(
        join(root, 'skills/apple/imessage/SKILL.md'),
        '---\nname: imessage\n---\nSend.\n',
      );
      writeFileSync(
        join(root, 'config.yaml'),
        read(root, 'config.yaml') +
          '  local:\n    command: npx\n    env:\n      TOKEN: ${LOCAL_TOKEN}\n      LITERAL: ghp_literal000111222333444555666777\n',
      );

      const captured = await hermesAdapter.export({ root });
      expect(captured.persona()).toContain('Hermes agent');
      expect(captured.skillNames()).toEqual(['imessage', 'triage']);
      expect(captured.memoryFacts().map((f) => f.text)).toContain('KEEP-ME-high-importance');
      expect(captured.memoryFacts()).toHaveLength(3);

      const servers = Object.fromEntries(captured.mcpServers().map((s) => [s.id, s]));
      expect(servers.github?.auth).toEqual({ type: 'bearer', credentialRef: 'github_pat' });
      expect(servers.local?.env).toEqual({
        TOKEN: '${credentialRef:local_token}',
        LITERAL: '${credentialRef:literal}',
      });
      expect(
        captured
          .manifest()
          .credentials.map((c) => c.ref)
          .sort(),
      ).toEqual(['github_pat', 'literal', 'local_token']);
      const text = new TextDecoder();
      for (const [, bytes] of captured.entries()) expect(text.decode(bytes)).not.toContain('ghp_');
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
      const hzPlan = await install(hz, bundle, RESOLVED);

      // Claude Code: skills + AGENTS.md + .mcp.json
      expect(existsSync(join(cc, '.claude/skills/triage/SKILL.md'))).toBe(true);
      expect(existsSync(join(cc, 'AGENTS.md'))).toBe(true);
      expect(existsSync(join(cc, '.mcp.json'))).toBe(true);
      // Hermes: SOUL.md + bounded memories/MEMORY.md + config.yaml mcp_servers
      expect(existsSync(join(hz, 'SOUL.md'))).toBe(true);
      expect(read(hz, 'memories/MEMORY.md').length).toBeLessThanOrEqual(MEMORY_MAX);
      expect(read(hz, 'config.yaml')).toContain('mcp_servers:');

      // Same brain, different lossiness: Claude Code transforms memory; Hermes truncates it.
      expect(ccPlan.lossiness.some((l) => l.action === 'transformed')).toBe(true);
      expect(hzPlan.lossiness.some((l) => l.action === 'truncated')).toBe(true);
    } finally {
      rmSync(cc, { recursive: true, force: true });
      rmSync(hz, { recursive: true, force: true });
    }
  });
});
