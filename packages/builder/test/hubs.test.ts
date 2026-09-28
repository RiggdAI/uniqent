import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  mapRegistryResponse,
  mcpRegistrySource,
  mapSmitheryResponse,
  githubSkillsSource,
  jsonIndexSource,
  searchMcpHubs,
  searchSkillHubs,
  installMcpHubResult,
  defaultMcpSources,
  defaultSkillSources,
  type CatalogSource,
  type FetchFn,
} from '../src/index.js';
import { Brain } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => readFileSync(resolve(here, 'fixtures', name), 'utf8');
// Real responses captured from the live hubs (trimmed to a few rows, otherwise verbatim).
const registryFixture = JSON.parse(fixture('mcp-registry.json'));
const smitheryFixture = JSON.parse(fixture('smithery.json'));
const githubSearchFixture = JSON.parse(fixture('github-skills-search.json'));
const githubSkillMd = fixture('github-skill-SKILL.md.txt');

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fetch that must never be called (source construction only). */
const noFetch: FetchFn = async (input) => {
  throw new Error(`unexpected fetch ${input}`);
};

describe('MCP Registry mapper', () => {
  const { results, skipped } = mapRegistryResponse(registryFixture);
  const byId = (id: string) => results.find((r) => r.entry.id === id);

  it('drops stale (non-latest) versions', () => {
    // The fixture has inference.sh 1.0.1 (stale) + 2.0.1 (latest); only one survives.
    expect(results.filter((r) => r.entry.id === 'ac-inference-sh-mcp')).toHaveLength(1);
  });

  it('maps a remote with no headers to streamable-http with no credential', () => {
    const remote = byId('ac-inference-sh-mcp');
    expect(remote?.entry.server.transport).toBe('streamable-http');
    expect(remote?.entry.server.url).toBe('https://api.inference.sh/mcp');
    expect(remote?.credentials).toHaveLength(0);
  });

  it('maps secret Authorization headers (bare or "Bearer {var}") to bearer auth + a credential', () => {
    for (const id of ['ae-propick-propick', 'ai-bamf-bamf']) {
      const r = byId(id);
      expect(r?.entry.server.auth).toEqual({ type: 'bearer', credentialRef: `${id}_token` });
      expect(r?.credentials.map((c) => [c.ref, c.required, c.consumedBy])).toEqual([
        [`${id}_token`, true, [`mcp:${id}`]],
      ]);
    }
  });

  it('maps a secret custom header to header auth', () => {
    const r = byId('ai-audiopod-audiopod');
    expect(r?.entry.server.auth).toEqual({
      type: 'header',
      headerName: 'X-API-Key',
      credentialRef: 'ai-audiopod-audiopod_x_api_key',
    });
  });

  it('maps an npm package: pinned version, -y, packageArguments, env → refs', () => {
    const s = byId('ai-dinglebear-arcane-rmcp')?.entry.server;
    expect(s?.command).toBe('npx');
    expect(s?.args).toEqual(['-y', 'arcane-rmcp@0.4.2', 'mcp']);
    // Secret → apiKey ref; required non-secret without a value → envVar ref; defaults literal.
    expect(s?.env?.RARCANE_API_KEY).toBe(
      '${credentialRef:ai-dinglebear-arcane-rmcp_rarcane_api_key}',
    );
    expect(s?.env?.RARCANE_API_URL).toBe(
      '${credentialRef:ai-dinglebear-arcane-rmcp_rarcane_api_url}',
    );
    expect(s?.env?.RUST_LOG).toBe('info');
    const creds = byId('ai-dinglebear-arcane-rmcp')?.credentials;
    expect(creds?.map((c) => c.type).sort()).toEqual(['apiKey', 'envVar']);
  });

  it('maps a pypi package to a pinned uvx command with its packageArguments', () => {
    const s = byId('io-github-06ketan-medium-ops')?.entry.server;
    expect([s?.command, ...(s?.args ?? [])]).toEqual(['uvx', 'medium-ops@0.1.2', 'mcp', 'serve']);
  });

  it('keeps valueless named arguments such as --stdio', () => {
    expect(byId('ai-midplane-midplane')?.entry.server.args).toEqual([
      '-y',
      'midplane@0.20.0',
      'server',
      '--stdio',
    ]);
  });

  it('maps an OCI package to docker run -i --rm with -e for each env var', () => {
    const s = byId('ai-apithreshold-apithreshold')?.entry.server;
    expect(s?.command).toBe('docker');
    expect(s?.args?.slice(0, 3)).toEqual(['run', '-i', '--rm']);
    expect(s?.args).toContain('OPENAI_API_KEY');
    expect(s?.args?.slice(-4)).toEqual([
      'ghcr.io/apithreshold/apithreshold:0.1.0',
      'serve',
      '--transport',
      'stdio',
    ]);
  });

  it('skips URL templates and unsupported registry types with a reason', () => {
    expect(skipped.map((s) => s.name).sort()).toEqual([
      'ai.autorfp/mcp',
      'cloud.anythink/anythink',
    ]);
    expect(skipped.find((s) => s.name === 'cloud.anythink/anythink')?.reason).toMatch(/nuget/);
    expect(skipped.find((s) => s.name === 'ai.autorfp/mcp')?.reason).toMatch(/\{api_host\}/);
  });

  it('every mapped server + its credentials installs into a brain and validates', () => {
    const b = Brain.create({
      name: 'demo',
      displayName: 'Demo',
      version: '0.1.0',
      description: 'd',
      author: { name: 'me' },
      license: 'CC0-1.0',
      tags: [],
    });
    b.setPersona('# Persona\n');
    for (const r of results) installMcpHubResult(b, r);
    const manifest = b.toBundle().manifest();
    expect(manifest.components.mcp).toContain('ai-dinglebear-arcane-rmcp');
    expect(manifest.credentials.find((c) => c.ref === 'ae-propick-propick_token')).toBeTruthy();
  });
});

describe('Smithery mapper', () => {
  it('maps remote servers to the gateway behind one shared smithery_api_key', () => {
    const { results } = mapSmitheryResponse(smitheryFixture);
    const r = results.find((x) => x.entry.id === 'jan-metz-software-doc-player');
    expect(r?.entry.server.transport).toBe('streamable-http');
    expect(r?.entry.server.url).toBe('https://server.smithery.ai/jan-metz-software/doc-player/mcp');
    expect(r?.entry.server.auth).toEqual({ type: 'bearer', credentialRef: 'smithery_api_key' });
    expect(r?.credentials[0]?.ref).toBe('smithery_api_key');
  });

  it('skips local-only (remote: false) servers with a reason', () => {
    const { results, skipped } = mapSmitheryResponse(smitheryFixture);
    expect(results.map((r) => r.entry.id)).not.toContain('xue20010808-readfile-mcp');
    expect(skipped.map((s) => s.name)).toEqual(['xue20010808/readfile_mcp']);
  });
});

describe('GitHub skills source', () => {
  it('emits only repos whose SKILL.md exists, named and described from its frontmatter', async () => {
    const calls: string[] = [];
    const f: FetchFn = (async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://api.github.com/')) {
        return new Response(JSON.stringify(githubSearchFixture));
      }
      if (url.includes('/savagedamage/ios-security-wizard/master/SKILL.md')) {
        return new Response(githubSkillMd);
      }
      return new Response('404: Not Found', { status: 404 });
    }) as FetchFn;
    const { results } = await githubSkillsSource({ fetch: f, token: undefined }).searchSkills!(
      'triage',
    );
    expect(results).toEqual([
      {
        source: 'github',
        name: 'ios-security-wizard',
        description: 'Use when doing iOS security: Mach-O, dyld, entitlements.',
        skillUrl:
          'https://raw.githubusercontent.com/savagedamage/ios-security-wizard/master/SKILL.md',
        repo: 'savagedamage/ios-security-wizard',
        stars: 2,
      },
    ]);
    // Candidates are checked on their default branch, never a guessed HEAD.
    expect(calls.some((u) => u.includes('/HEAD/'))).toBe(false);
  });

  it('explains a rate-limit 403 with status, body, and the GITHUB_TOKEN hint', async () => {
    const f: FetchFn = (async () =>
      new Response('{"message":"API rate limit exceeded"}', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      })) as FetchFn;
    const { errors } = await searchSkillHubs('x', [
      githubSkillsSource({ fetch: f, token: undefined }),
    ]);
    expect(errors[0]?.message).toMatch(/403/);
    expect(errors[0]?.message).toMatch(/API rate limit exceeded/);
    expect(errors[0]?.message).toMatch(/10 requests\/min.*GITHUB_TOKEN/);
  });
});

describe('default sources', () => {
  it('assembles MCP + skill source sets including any JSON indexes (no GitHub MCP guessing)', () => {
    const mcp = defaultMcpSources({ fetch: noFetch, jsonIndexUrls: ['https://hub/index.json'] });
    expect(mcp.map((s) => s.id)).toEqual(['mcp-registry', 'smithery', 'json-index']);
    const skills = defaultSkillSources({
      fetch: noFetch,
      jsonIndexUrls: [],
      githubToken: undefined,
    });
    expect(skills.map((s) => s.id)).toEqual(['github']);
  });
});

describe('hub source over fetch', () => {
  it('mcpRegistrySource asks for the latest versions and maps the response', async () => {
    let called = '';
    const f: FetchFn = (async (input: unknown) => {
      called = String(input);
      return new Response(JSON.stringify(registryFixture));
    }) as FetchFn;
    const src = mcpRegistrySource({ fetch: f, limit: 5 });
    const out = await src.searchMcp!('filesystem');
    expect(called).toContain('search=filesystem');
    expect(called).toContain('version=latest');
    expect(called).toContain('limit=5');
    expect(out.results.length).toBeGreaterThan(0);
  });

  const index = {
    mcp: [
      {
        id: 'acme',
        name: 'Acme',
        description: 'acme tools',
        server: {
          id: 'acme',
          transport: 'stdio',
          command: 'npx',
          auth: { type: 'none' },
          tools: { include: 'all' },
        },
      },
    ],
    skills: [
      { name: 'triage', description: 'triage issues', skillUrl: 'https://x/SKILL.md' },
      { name: 'writing', description: 'prose', skillUrl: 'https://y/SKILL.md' },
    ],
  };

  it('jsonIndexSource filters mcp + skills by query', async () => {
    const f: FetchFn = (async () => new Response(JSON.stringify(index))) as FetchFn;
    const src = jsonIndexSource({ fetch: f, url: 'https://hub/index.json', label: 'JSON index' });
    expect((await src.searchMcp!('acme')).results.length).toBe(1);
    const skills = (await src.searchSkills!('triage')).results;
    expect(skills.map((s) => s.name)).toEqual(['triage']);
    expect(skills[0]?.source).toBe('json-index');
  });

  it('jsonIndexSource rejects an index that does not match the schema', async () => {
    const bad = { mcp: [{ ...index.mcp[0], server: { id: 'acme', transport: 'stdio' } }] };
    const f: FetchFn = (async () => new Response(JSON.stringify(bad))) as FetchFn;
    const src = jsonIndexSource({ fetch: f, url: 'https://hub/index.json', label: 'JSON index' });
    await expect(src.searchMcp!('')).rejects.toThrow(/not a valid hub index/);
  });
});

describe('aggregator isolation', () => {
  const good: CatalogSource = {
    id: 'good',
    label: 'good',
    async searchMcp() {
      return mapRegistryResponse(registryFixture);
    },
    async searchSkills() {
      return { results: [{ source: 'good', name: 's', description: 'd', stars: 3 }], skipped: [] };
    },
  };
  const bad: CatalogSource = {
    id: 'bad',
    label: 'bad',
    async searchMcp() {
      throw new Error('hub down');
    },
    async searchSkills() {
      throw new Error('hub down');
    },
  };

  it('one failing source does not fail the search; it is reported', async () => {
    const { results, errors, skipped } = await searchMcpHubs('x', [good, bad]);
    expect(results.length).toBeGreaterThan(0);
    expect(errors).toEqual([{ source: 'bad', message: 'hub down' }]);
    expect(skipped.length).toBe(2);
  });

  it('skill search isolates failures too', async () => {
    const { results, errors } = await searchSkillHubs('x', [good, bad]);
    expect(results.map((r) => r.name)).toContain('s');
    expect(errors[0]?.source).toBe('bad');
  });

  it('a hanging hub times out (after a retry) and is reported, not awaited forever', async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(20));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f: FetchFn = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as FetchFn;
    const { results, errors } = await searchMcpHubs('x', [good, mcpRegistrySource({ fetch: f })]);
    expect(results.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.source).toBe('mcp-registry');
    expect(errors[0]?.message).toMatch(/timed out/);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
