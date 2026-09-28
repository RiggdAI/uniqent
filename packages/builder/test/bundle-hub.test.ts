import { describe, expect, it, vi } from 'vitest';
import { publishBundle } from '../src/hubs/bundle-hub.js';

function stubFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
}

describe('publishBundle', () => {
  it('POSTs raw bytes with a Bearer token to /api/v1/bundles and returns the parsed result', async () => {
    const fetchFn = stubFetch(200, {
      ok: true,
      name: 'demo',
      version: '1.0.0',
      url: 'https://cdn/x',
      signed: true,
      persisted: true,
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const res = await publishBundle(
      fetchFn,
      'https://uniqent.ai/',
      'unq_live_abc',
      bytes,
      undefined,
    );

    expect(res).toEqual({
      ok: true,
      name: 'demo',
      version: '1.0.0',
      url: 'https://cdn/x',
      signed: true,
      persisted: true,
    });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://uniqent.ai/api/v1/bundles'); // trailing slash normalized
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer unq_live_abc');
    expect((init.headers as Record<string, string>)['content-type']).toBe(
      'application/octet-stream',
    );
    expect(init.body).toBe(bytes);
  });

  it('throws the server error message on non-ok', async () => {
    const f = stubFetch(409, { error: 'namespace owned by another publisher' });
    await expect(
      publishBundle(f, 'https://uniqent.ai', 't', new Uint8Array(), undefined),
    ).rejects.toThrow('namespace owned by another publisher');
  });

  it('throws the server error message on 200 {ok: false}', async () => {
    const f = stubFetch(200, { ok: false, error: 'rejected' });
    await expect(
      publishBundle(f, 'https://uniqent.ai', 't', new Uint8Array(), undefined),
    ).rejects.toThrow(/rejected/);
  });

  it('requires a token', async () => {
    const f = stubFetch(200, {});
    await expect(
      publishBundle(f, 'https://uniqent.ai', '', new Uint8Array(), undefined),
    ).rejects.toThrow(/token/);
  });
});
