import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Per-registry stored tokens: { "<registry base>": { token } }. */
type Store = Record<string, { token: string }>;

const normalize = (registry: string) => registry.replace(/\/+$/, '');

function configDir(): string {
  return process.env.UNIQENT_CONFIG_DIR ?? join(homedir(), '.uniqent');
}
function credentialsPath(): string {
  return join(configDir(), 'credentials.json');
}

async function read(): Promise<Store> {
  try {
    return JSON.parse(await readFile(credentialsPath(), 'utf8')) as Store;
  } catch {
    return {}; // missing or corrupt → empty
  }
}

async function write(store: Store): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(credentialsPath(), JSON.stringify(store, null, 2), { mode: 0o600 });
}

export async function loadToken(registry: string): Promise<string | undefined> {
  const store = await read();
  return store[normalize(registry)]?.token;
}

export async function saveToken(registry: string, token: string): Promise<void> {
  const store = await read();
  store[normalize(registry)] = { token };
  await write(store);
}

export async function clearToken(registry: string): Promise<boolean> {
  const store = await read();
  const key = normalize(registry);
  if (!(key in store)) return false;
  delete store[key];
  await write(store);
  return true;
}

/** Token precedence: explicit flag → UNIQENT_PUBLISH_TOKEN → stored login. */
export async function resolveToken(opts: {
  flag?: string | true;
  registry: string;
}): Promise<string | undefined> {
  if (typeof opts.flag === 'string' && opts.flag) return opts.flag;
  const env = process.env.UNIQENT_PUBLISH_TOKEN;
  if (env && env.length > 0) return env;
  return loadToken(opts.registry);
}
