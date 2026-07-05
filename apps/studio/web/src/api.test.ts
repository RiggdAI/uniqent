import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

describe('api shim (native)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
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

  it('rejects unimplemented methods with the coming-soon message', async () => {
    const { api } = await import('./api');
    // Phase 3b/4 stubs — must ALL still reject in native
    const SOON = /not yet available in the native app/;
    await expect(api.memoryHub('query')).rejects.toThrow(SOON);
    await expect(api.addMemoryPack('slug')).rejects.toThrow(SOON);
    await expect(api.publishMemory('token')).rejects.toThrow(SOON);
    await expect(api.previewVault('/path')).rejects.toThrow(SOON);
    await expect(api.importVault('/path')).rejects.toThrow(SOON);
    await expect(api.importSkillFromUrl('https://example.com/skill.md')).rejects.toThrow(SOON);
    await expect(api.addPastedMcp('text')).rejects.toThrow(SOON);
    await expect(api.installPlan('target', '/root')).rejects.toThrow(SOON);
    await expect(api.install('target', '/root', {})).rejects.toThrow(SOON);
    await expect(api.hubMcp('query')).rejects.toThrow(SOON);
    await expect(api.hubSkills('query')).rejects.toThrow(SOON);
    await expect(
      api.addHubMcp({
        source: 'hub',
        entry: { id: 'x', name: 'x', description: 'x', server: { transport: 'http' } },
        credentials: [],
      }),
    ).rejects.toThrow(SOON);
    await expect(api.addHubSkill('url')).rejects.toThrow(SOON);
    await expect(api.hubIndexes()).rejects.toThrow(SOON);
    await expect(api.setHubIndexes(['url'])).rejects.toThrow(SOON);
    expect(invokeMock).not.toHaveBeenCalled();
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
