import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadToken, saveToken, clearToken, resolveToken } from '../src/credentials.js';

let dir: string;
const REG = 'https://uniqent.ai';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'unq-cred-'));
  process.env.UNIQENT_CONFIG_DIR = dir;
  delete process.env.UNIQENT_PUBLISH_TOKEN;
});
afterEach(async () => {
  delete process.env.UNIQENT_CONFIG_DIR;
  delete process.env.UNIQENT_PUBLISH_TOKEN;
  await rm(dir, { recursive: true, force: true });
});

describe('credential store', () => {
  it('saves and loads a token per registry', async () => {
    await saveToken(REG, 'unq_live_a');
    expect(await loadToken(REG)).toBe('unq_live_a');
    expect(await loadToken('https://other.example')).toBeUndefined();
  });

  it('normalizes a trailing slash in the registry key', async () => {
    await saveToken('https://uniqent.ai/', 'unq_live_b');
    expect(await loadToken('https://uniqent.ai')).toBe('unq_live_b');
  });

  it('clears a token and reports whether one existed', async () => {
    await saveToken(REG, 'x');
    expect(await clearToken(REG)).toBe(true);
    expect(await loadToken(REG)).toBeUndefined();
    expect(await clearToken(REG)).toBe(false);
  });

  it('returns undefined for a missing/corrupt file, never throws', async () => {
    expect(await loadToken(REG)).toBeUndefined();
  });
});

describe('resolveToken precedence', () => {
  it('prefers the flag, then env, then stored', async () => {
    await saveToken(REG, 'stored');
    expect(await resolveToken({ flag: 'flagtok', registry: REG })).toBe('flagtok');

    process.env.UNIQENT_PUBLISH_TOKEN = 'envtok';
    expect(await resolveToken({ flag: true, registry: REG })).toBe('envtok'); // flag===true means "no value"
    expect(await resolveToken({ registry: REG })).toBe('envtok');

    delete process.env.UNIQENT_PUBLISH_TOKEN;
    expect(await resolveToken({ registry: REG })).toBe('stored');
  });

  it('returns undefined when nothing is set', async () => {
    expect(await resolveToken({ registry: REG })).toBeUndefined();
  });
});
