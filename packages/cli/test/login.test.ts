import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';
import { loadToken } from '../src/credentials.js';

let dir: string;
let out: string[];
let err: string[];
const io = (prompt?: (q: string) => Promise<string>) => ({
  log: (m: string) => out.push(m),
  error: (m: string) => err.push(m),
  ...(prompt ? { prompt } : {}),
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'unq-login-'));
  process.env.UNIQENT_CONFIG_DIR = dir;
  out = [];
  err = [];
});
afterEach(async () => {
  delete process.env.UNIQENT_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe('login', () => {
  it('stores a token passed via --token', async () => {
    const code = await run(['login', '--token', 'unq_live_flag'], io());
    expect(code).toBe(0);
    expect(await loadToken('https://uniqent.ai')).toBe('unq_live_flag');
  });

  it('logout clears the stored token', async () => {
    await run(['login', '--token', 't'], io());
    const code = await run(['logout'], io());
    expect(code).toBe(0);
    expect(await loadToken('https://uniqent.ai')).toBeUndefined();
  });
});

describe('login (device flow)', () => {
  it('runs the browser device flow when no --token and stores the returned token', async () => {
    const origTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: 'dc',
            user_code: 'AAAA-BBBB',
            verify_url: 'https://uniqent.ai/device?code=AAAA-BBBB',
            interval: 0,
            expires_in: 600,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'approved', token: 'unq_live_device' }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetchFn);
    try {
      const code = await run(['login'], io()); // no --token, no prompt → device flow
      expect(code).toBe(0);
      expect(await loadToken('https://uniqent.ai')).toBe('unq_live_device');
    } finally {
      vi.unstubAllGlobals();
      if (origTTY) Object.defineProperty(process.stdout, 'isTTY', origTTY);
    }
  });

  it('errors (no hang) when headless with no --token', async () => {
    const origTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    try {
      const code = await run(['login'], io());
      expect(code).toBe(1);
      expect(fetchFn).not.toHaveBeenCalled();
      expect(err.join('\n')).toMatch(/--token/);
    } finally {
      vi.unstubAllGlobals();
      if (origTTY) Object.defineProperty(process.stdout, 'isTTY', origTTY);
    }
  });
});

describe('publish-memory uses the stored token', () => {
  it('does not require --token once logged in', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, slug: 'p', factCount: 1 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchFn);
    try {
      await run(['login', '--token', 'unq_live_stored'], io());
      const pack = join(dir, 'p.json');
      await writeFile(
        pack,
        JSON.stringify({ slug: 'p', name: 'P', facts: [{ kind: 'fact', text: 'hi' }] }),
      );
      const code = await run(['publish-memory', pack], io()); // no --token; stored token must be used
      expect(code).toBe(0);
      const [, init] = fetchFn.mock.calls[0];
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer unq_live_stored');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
