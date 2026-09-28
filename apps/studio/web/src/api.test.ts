import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
const httpFetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => httpFetchMock(...a) }));

describe('api shim (native)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    httpFetchMock.mockReset();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {}; // native detection
    vi.resetModules();
  });

  it('routes implemented methods through invoke with mapped args', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.setPersona('hello');
    expect(invokeMock).toHaveBeenCalledWith('set_persona', { persona: 'hello' });
    await api.setMeta({ name: 'x' });
    expect(invokeMock).toHaveBeenCalledWith('set_meta', { meta: { name: 'x' } });
    await api.removeAvatar();
    expect(invokeMock).toHaveBeenCalledWith('remove_avatar');
  });

  it('routes MCP mutators through invoke', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.addMcp('some-mcp');
    expect(invokeMock).toHaveBeenCalledWith('add_mcp_catalog', { id: 'some-mcp' });
    await api.addCustomMcp({ id: 'my-mcp', url: 'https://example.com' });
    expect(invokeMock).toHaveBeenCalledWith('add_custom_mcp', {
      server: { id: 'my-mcp', url: 'https://example.com' },
    });
    await api.importMcpServers([{ id: 'srv1' }]);
    expect(invokeMock).toHaveBeenCalledWith('import_mcp_servers', { servers: [{ id: 'srv1' }] });
    await api.removeMcp('some-mcp');
    expect(invokeMock).toHaveBeenCalledWith('remove_mcp', { id: 'some-mcp' });
  });

  it('routes pasteMcpPreview through invoke', async () => {
    invokeMock.mockResolvedValue({ servers: [], credentials: [], lossiness: [] });
    const { api } = await import('./api');
    await api.pasteMcpPreview('{"mcpServers":{}}');
    expect(invokeMock).toHaveBeenCalledWith('paste_mcp_preview', {
      text: '{"mcpServers":{}}',
    });
  });

  it('routes addPastedMcp through invoke', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.addPastedMcp('{"mcpServers":{}}');
    expect(invokeMock).toHaveBeenCalledWith('add_pasted_mcp', {
      text: '{"mcpServers":{}}',
    });
  });

  it('routes skill mutators through invoke', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.addSkill('my-skill');
    expect(invokeMock).toHaveBeenCalledWith('add_skill_catalog', { name: 'my-skill' });
    await api.addCustomSkill('custom', '# Custom skill');
    expect(invokeMock).toHaveBeenCalledWith('add_custom_skill', {
      name: 'custom',
      skillMd: '# Custom skill',
    });
    await api.removeSkill('my-skill');
    expect(invokeMock).toHaveBeenCalledWith('remove_skill', { name: 'my-skill' });
  });

  it('routes channel mutators through invoke', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.addChannel('slack');
    expect(invokeMock).toHaveBeenCalledWith('add_channel_catalog', { id: 'slack' });
    await api.removeChannel('slack');
    expect(invokeMock).toHaveBeenCalledWith('remove_channel', { id: 'slack' });
  });

  it('routes task mutators through invoke', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.addTask({ name: 'daily', cron: '0 9 * * *', prompt: 'Do the thing' });
    expect(invokeMock).toHaveBeenCalledWith('add_task', {
      payload: { name: 'daily', cron: '0 9 * * *', prompt: 'Do the thing' },
    });
    await api.removeTask('task-1');
    expect(invokeMock).toHaveBeenCalledWith('remove_task', { id: 'task-1' });
  });

  it('routes memory mutators through invoke', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.addMemory('I like cats', 0.9);
    expect(invokeMock).toHaveBeenCalledWith('add_memory', { text: 'I like cats', importance: 0.9 });
    await api.importMemory({ text: 'line1\nline2' });
    expect(invokeMock).toHaveBeenCalledWith('import_memory', {
      payload: { text: 'line1\nline2' },
    });
  });

  it('routes previewMemory through invoke', async () => {
    invokeMock.mockResolvedValue({ items: [], graph: { nodes: [], edges: [] } });
    const { api } = await import('./api');
    await api.previewMemory('- fact: I like cats');
    expect(invokeMock).toHaveBeenCalledWith('preview_memory', { text: '- fact: I like cats' });
  });

  it('routes memoryGraph through invoke', async () => {
    invokeMock.mockResolvedValue({ nodes: [], edges: [] });
    const { api } = await import('./api');
    await api.memoryGraph();
    expect(invokeMock).toHaveBeenCalledWith('memory_graph');
  });

  it('routes profile commands through invoke', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.setProfile({ name: 'Alice', role: 'engineer' });
    expect(invokeMock).toHaveBeenCalledWith('set_profile', {
      profile: { name: 'Alice', role: 'engineer' },
    });
    invokeMock.mockResolvedValue({ profile: { name: 'Alice' } });
    await api.getProfile();
    expect(invokeMock).toHaveBeenCalledWith('get_profile');
  });

  it('keeps install stubbed until Phase 4, with a pointer to the CLI', async () => {
    const { api } = await import('./api');
    const PHASE4 = /Phase 4.*uniqent install/;
    await expect(api.installPlan('target', '/root')).rejects.toThrow(PHASE4);
    await expect(api.install('target', '/root', {})).rejects.toThrow(PHASE4);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('has no Phase 3b "not yet available" stubs left', async () => {
    const src = (await import('node:fs')).readFileSync(
      new URL('./api.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toMatch(/not yet available in the native app/);
  });

  it('adds a hub MCP result through add_mcp_hub_result with every credential', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.addHubMcp({
      source: 'mcp-registry',
      entry: { id: 'linear', name: 'Linear', description: '', server: { id: 'linear' } },
      credentials: [{ ref: 'linear_token' }],
    } as never);
    expect(invokeMock).toHaveBeenCalledWith('add_mcp_hub_result', {
      server: { id: 'linear' },
      credentials: [{ ref: 'linear_token' }],
    });
  });

  it('reads and writes hub indexes through Rust', async () => {
    invokeMock.mockResolvedValue(['https://a.example/i.json']);
    const { api } = await import('./api');
    expect(await api.hubIndexes()).toEqual({ indexes: ['https://a.example/i.json'] });
    expect(await api.setHubIndexes(['https://a.example/i.json'])).toEqual({
      indexes: ['https://a.example/i.json'],
    });
    expect(invokeMock).toHaveBeenCalledWith('set_hub_indexes', {
      urls: ['https://a.example/i.json'],
    });
  });

  it('imports a skill from an https URL via the plugin fetch and names it from frontmatter', async () => {
    httpFetchMock.mockResolvedValue(new Response('---\nname: triage\n---\nBody'));
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.importSkillFromUrl('https://example.com/triage/SKILL.md');
    expect(invokeMock).toHaveBeenCalledWith('add_custom_skill', {
      name: 'triage',
      skillMd: '---\nname: triage\n---\nBody',
    });
  });

  it('refuses a non-https skill URL without fetching', async () => {
    const { api } = await import('./api');
    await expect(api.importSkillFromUrl('http://example.com/SKILL.md')).rejects.toThrow(/https/);
    expect(httpFetchMock).not.toHaveBeenCalled();
  });

  it('previews a vault from Rust-read files with the shared parser', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'read_vault'
        ? [
            { path: 'SOUL.md', content: 'I am Atlas.' },
            { path: 'MEMORY.md', content: '- Uses Postgres' },
          ]
        : null,
    );
    const { api } = await import('./api');
    const { result } = await api.previewVault('/picked/vault');
    expect(invokeMock).toHaveBeenCalledWith('read_vault', { dir: '/picked/vault' });
    expect(result.persona).toContain('Atlas');
    expect(result.items.map((i) => i.text)).toContain('Uses Postgres');
  });

  it('imports a vault: persona, then items with their source', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'read_vault'
        ? [
            { path: 'SOUL.md', content: 'I am Atlas.' },
            { path: 'notes/db.md', content: '- Uses Postgres' },
          ]
        : { manifest: {}, validation: { ok: true } },
    );
    const { api } = await import('./api');
    const { stats } = await api.importVault('/picked/vault', { persona: true, profile: true });
    expect(invokeMock).toHaveBeenCalledWith('set_persona', { persona: 'I am Atlas.' });
    const importCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'import_memory');
    expect(importCall?.[1]).toEqual({
      payload: { items: [{ text: 'Uses Postgres', kind: 'fact', source: 'notes/db.md' }] },
    });
    expect(stats.items).toBe(1);
  });

  it('publishes with the stored login token when none is typed', async () => {
    invokeMock.mockImplementation(async (cmd: string) =>
      cmd === 'registry_token'
        ? 'tok'
        : cmd === 'publish_payload'
          ? {
              slug: 'b',
              name: 'B',
              description: '',
              tags: [],
              facts: [{ kind: 'fact', text: 't' }],
            }
          : null,
    );
    httpFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ slug: 'b', factCount: 1 }), { status: 201 }),
    );
    const { api } = await import('./api');
    const { result } = await api.publishMemory('', 'https://uniqent.ai');
    const [url, init] = httpFetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://uniqent.ai/api/v1/memory');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(result.factCount).toBe(1);
  });

  it('says to log in when publishing without any token', async () => {
    invokeMock.mockImplementation(async (cmd: string) => (cmd === 'registry_token' ? null : null));
    const { api } = await import('./api');
    await expect(api.publishMemory('', 'https://uniqent.ai')).rejects.toThrow(/uniqent login/);
    expect(httpFetchMock).not.toHaveBeenCalled();
  });

  it('routes export through invoke with sign arg', async () => {
    invokeMock.mockResolvedValue({
      filename: 'my-brain.uniqent',
      bytesBase64: 'abc=',
      signed: true,
      verified: true,
      validation: { ok: true, errors: [], warnings: [] },
    });
    const { api } = await import('./api');
    await api.export(true);
    expect(invokeMock).toHaveBeenCalledWith('export', { sign: true });
  });

  it('falls back to fetch when not running under Tauri', async () => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');
    await api.state();
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
