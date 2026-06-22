import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDeviceLogin } from '../src/device.js';

afterEach(() => vi.restoreAllMocks());

function res(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}
const io = () => {
  const log: string[] = [];
  const err: string[] = [];
  return { io: { log: (m: string) => log.push(m), error: (m: string) => err.push(m) }, log, err };
};

describe('runDeviceLogin', () => {
  it('starts, opens the browser, polls until approved, and returns the token', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(200, { device_code: 'dc', user_code: 'WXYZ-1234', verify_url: 'https://uniqent.ai/device?code=WXYZ-1234', interval: 0, expires_in: 600 }))
      .mockResolvedValueOnce(res(200, { status: 'pending' }))
      .mockResolvedValueOnce(res(200, { status: 'approved', token: 'unq_live_dev' }));
    const opened: string[] = [];
    const t = io();

    const token = await runDeviceLogin({
      registry: 'https://uniqent.ai/',
      io: t.io,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      open: (u) => opened.push(u),
      sleep: async () => {},
    });

    expect(token).toBe('unq_live_dev');
    expect(opened).toEqual(['https://uniqent.ai/device?code=WXYZ-1234']);
    // start URL normalized (no double slash), poll body carries the device_code
    expect((fetchImpl.mock.calls[0][0] as string)).toBe('https://uniqent.ai/api/v1/device/start');
    expect(JSON.parse((fetchImpl.mock.calls[2][1] as RequestInit).body as string)).toEqual({ device_code: 'dc' });
    expect(t.log.join('\n')).toMatch(/WXYZ-1234/); // user_code shown
  });

  it('returns null when the code expires', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(200, { device_code: 'dc', user_code: 'C', verify_url: 'u', interval: 0, expires_in: 600 }))
      .mockResolvedValueOnce(res(200, { status: 'expired' }));
    const t = io();
    const token = await runDeviceLogin({ registry: 'https://uniqent.ai', io: t.io, fetchImpl: fetchImpl as unknown as typeof fetch, open: () => {}, sleep: async () => {} });
    expect(token).toBeNull();
    expect(t.err.join('\n')).toMatch(/expired|not approved/i);
  });

  it('returns null when device start fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(503, { error: 'no database configured' }));
    const t = io();
    const token = await runDeviceLogin({ registry: 'https://uniqent.ai', io: t.io, fetchImpl: fetchImpl as unknown as typeof fetch, open: () => {}, sleep: async () => {} });
    expect(token).toBeNull();
    expect(t.err.join('\n')).toMatch(/start failed|503/);
  });

  it('returns null immediately (no poll) when expires_in is 0', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res(200, { device_code: 'dc', user_code: 'T', verify_url: 'u', interval: 0, expires_in: 0 }));
    const t = io();
    const token = await runDeviceLogin({ registry: 'https://uniqent.ai', io: t.io, fetchImpl: fetchImpl as unknown as typeof fetch, open: () => {}, sleep: async () => {} });
    expect(token).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the start call; no poll
    expect(t.err.join('\n')).toMatch(/timed out/i);
  });
});
