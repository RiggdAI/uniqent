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

  it('rejects unimplemented methods with the coming-soon message', async () => {
    const { api } = await import('./api');
    await expect(api.memoryGraph()).rejects.toThrow(/not yet available in the native app/);
    expect(invokeMock).not.toHaveBeenCalled();
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
