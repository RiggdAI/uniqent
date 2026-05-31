import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  mapRegistryResponse,
  mcpRegistrySource,
  jsonIndexSource,
  searchMcpHubs,
  searchSkillHubs,
  installMcpHubResult,
  type CatalogSource,
} from '../src/index.js';
import { Brain } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const registryFixture = JSON.parse(
  readFileSync(resolve(here, 'fixtures/mcp-registry.json'), 'utf8'),
);

describe('MCP Registry mapper', () => {
  const results = mapRegistryResponse(registryFixture);

  it('drops stale (non-latest) versions', () => {
    // The fixture has inference.sh 1.0.0 (stale) + 1.0.1 (latest); only one survives.
    expect(results.filter((r) => r.entry.id === 'ac-inference-sh-mcp')).toHaveLength(1);
  });

  it('maps a remote server to streamable-http with no credential', () => {
    const remote = results.find((r) => r.entry.id === 'ac-inference-sh-mcp');
    expect(remote?.entry.server.transport).toBe('streamable-http');
    expect(remote?.entry.server.url).toBe('https://api.inference.sh/mcp');
    expect(remote?.credentials).toHaveLength(0);
  });

  it('maps a stdio package: command/args and secret env → credentialRef', () => {
    const fs = results.find((r) => r.entry.id === 'com-pulsemcp-remote-filesystem');
    expect(fs?.entry.server.transport).toBe('stdio');
    expect(fs?.entry.server.command).toBe('npx');
    expect(fs?.entry.server.args).toEqual(['-y', 'remote-filesystem-mcp-server']);
    // Secret env becomes a placeholder; non-secret keeps a literal default; no secret value leaks.
    expect(fs?.entry.server.env?.GCS_PRIVATE_KEY).toBe(
      '${credentialRef:com-pulsemcp-remote-filesystem_gcs_private_key}',
    );
    expect(fs?.entry.server.env?.GCS_MAKE_PUBLIC).toBe('false');
    expect(fs?.credentials).toHaveLength(1);
    expect(fs?.credentials[0]?.consumedBy).toEqual(['mcp:com-pulsemcp-remote-filesystem']);
  });

  it('the mapped server + credentials install into a brain and validate', () => {
    const fs = results.find((r) => r.entry.id === 'com-pulsemcp-remote-filesystem')!;
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
    installMcpHubResult(b, fs);
    const manifest = b.toBundle().manifest();
    expect(manifest.components.mcp).toContain('com-pulsemcp-remote-filesystem');
    expect(
      manifest.credentials.find((c) => c.ref === 'com-pulsemcp-remote-filesystem_gcs_private_key'),
    ).toBeTruthy();
  });
});

describe('hub source over fetch', () => {
  it('mcpRegistrySource builds a search URL and maps the response', async () => {
    const orig = globalThis.fetch;
    let called = '';
    try {
      globalThis.fetch = (async (input: unknown) => {
        called = String(input);
        return new Response(JSON.stringify(registryFixture));
      }) as typeof fetch;
      const src = mcpRegistrySource({ limit: 5 });
      const out = await src.searchMcp!('filesystem');
      expect(called).toContain('search=filesystem');
      expect(called).toContain('limit=5');
      expect(out.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('jsonIndexSource filters mcp + skills by query', async () => {
    const orig = globalThis.fetch;
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
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify(index))) as typeof fetch;
      const src = jsonIndexSource('https://hub/index.json');
      expect((await src.searchMcp!('acme')).length).toBe(1);
      const skills = await src.searchSkills!('triage');
      expect(skills.map((s) => s.name)).toEqual(['triage']);
      expect(skills[0]?.source).toBe('json-index');
    } finally {
      globalThis.fetch = orig;
    }
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
      return [{ source: 'good', name: 's', description: 'd', stars: 3 }];
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
    const { results, errors } = await searchMcpHubs('x', [good, bad]);
    expect(results.length).toBeGreaterThan(0);
    expect(errors).toEqual([{ source: 'bad', message: 'hub down' }]);
  });

  it('skill search isolates failures too', async () => {
    const { results, errors } = await searchSkillHubs('x', [good, bad]);
    expect(results.map((r) => r.name)).toContain('s');
    expect(errors[0]?.source).toBe('bad');
  });
});
