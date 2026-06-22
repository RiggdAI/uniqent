import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';

let dir: string;
let out: string[];
let err: string[];
const io = () => ({ log: (m: string) => out.push(m), error: (m: string) => err.push(m) });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'unq-pub-'));
  process.env.UNIQENT_CONFIG_DIR = dir;
  process.env.UNIQENT_PUBLISH_TOKEN = 'unq_live_env';
  out = [];
  err = [];
});
afterEach(async () => {
  delete process.env.UNIQENT_CONFIG_DIR;
  delete process.env.UNIQENT_PUBLISH_TOKEN;
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function makeBundleFile(): Promise<string> {
  // A pre-packed .uniqent file path; publish reads its bytes and POSTs them as-is.
  const f = join(dir, 'demo.uniqent');
  await writeFile(f, Buffer.from([1, 2, 3, 4]));
  return f;
}

describe('publish', () => {
  it('sends the bytes with a Bearer token and logs success on 200', async () => {
    const fetchFn = stubFetch(200, {
      ok: true,
      name: 'demo',
      version: '1.2.3',
      signed: true,
      persisted: true,
    });
    const file = await makeBundleFile();
    const code = await run(['publish', file], io());

    expect(code).toBe(0);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://uniqent.ai/api/v1/bundles');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer unq_live_env');
    expect(out.join('\n')).toMatch(/published demo@1\.2\.3.*signed/);
  });

  it('maps 401 to a login hint and exits 1', async () => {
    stubFetch(401, { error: 'unauthorized' });
    const code = await run(['publish', await makeBundleFile()], io());
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/uniqent login/);
  });

  it('maps 409 to an ownership message and exits 1', async () => {
    stubFetch(409, { error: 'namespace owned by another publisher' });
    const code = await run(['publish', await makeBundleFile()], io());
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/owned by another publisher/);
  });

  it('errors with a login hint when no token is available', async () => {
    delete process.env.UNIQENT_PUBLISH_TOKEN; // and nothing stored
    const code = await run(['publish', await makeBundleFile()], io());
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/uniqent login/);
  });

  it('errors when no bundle path is given', async () => {
    const code = await run(['publish'], io());
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/missing/);
  });

  it('packs a directory on the fly and uploads the bytes with a Bearer token', async () => {
    const dirPath = join(__dirname, '..', '..', '..', 'examples', 'research-analyst');
    const fetchFn = stubFetch(200, {
      ok: true,
      name: 'research-analyst',
      version: '0.1.0',
      signed: false,
      persisted: true,
    });

    const code = await run(['publish', dirPath], io());

    expect(code).toBe(0);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://uniqent.ai/api/v1/bundles');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer unq_live_env');
    expect((init.body as Uint8Array).byteLength).toBeGreaterThan(0);
    expect(out.join('\n')).toMatch(/published research-analyst@0\.1\.0/);
  });
});
