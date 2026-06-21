import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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

  it('prompts for the token when interactive and none is passed', async () => {
    const code = await run(['login'], io(async () => 'unq_live_prompted'));
    expect(code).toBe(0);
    expect(await loadToken('https://uniqent.ai')).toBe('unq_live_prompted');
  });

  it('errors when non-interactive with no --token', async () => {
    const code = await run(['login'], io()); // no prompt provided
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/--token/);
  });

  it('logout clears the stored token', async () => {
    await run(['login', '--token', 't'], io());
    const code = await run(['logout'], io());
    expect(code).toBe(0);
    expect(await loadToken('https://uniqent.ai')).toBeUndefined();
  });
});
