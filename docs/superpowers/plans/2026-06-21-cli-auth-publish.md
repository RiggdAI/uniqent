# CLI Auth (login + publish + polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@uniqent/cli` npm-style auth — `uniqent login`/`logout` (stored per-user token), a new `uniqent publish <dir|file>` for brain bundles, and make `publish-memory` use the stored token — against the now-authenticated registry.

**Architecture:** A small per-registry credential store (`~/.uniqent/credentials.json`) provides `resolveToken` with precedence `--token → UNIQENT_PUBLISH_TOKEN → stored`. A new `publishBundle` in `@uniqent/builder` POSTs raw `.uniqent` bytes to `/api/v1/bundles` with a Bearer token. New CLI commands wire these in; `publish-memory` switches to `resolveToken`.

**Tech Stack:** TypeScript (ESM, `node16` module resolution — imports use `.js` suffixes), pnpm monorepo, Vitest (`test/**/*.test.ts`), Node built-ins (`node:fs/promises`, `node:os`, `node:path`).

## Global Constraints

- This is the `uniqent` monorepo, branch `feat/cli-auth-publish`. Commit there; do not switch branches.
- ESM with `node16`-style resolution: **all relative imports use a `.js` extension** (e.g. `import { resolveToken } from './credentials.js'`), matching existing files.
- Credential file: `join(homedir(), '.uniqent', 'credentials.json')`, written with mode `0600`, keyed by the **normalized registry base** (`url.replace(/\/+$/, '')`). For testability the base dir is `process.env.UNIQENT_CONFIG_DIR ?? join(homedir(), '.uniqent')` — tests set `UNIQENT_CONFIG_DIR` to a temp dir.
- Token precedence everywhere: `--token` flag (if a string) → `process.env.UNIQENT_PUBLISH_TOKEN` → stored token → none.
- Default registry: `DEFAULT_HUB = 'https://uniqent.ai'` (already defined in `run.ts`).
- Bundle publish endpoint: `POST {base}/api/v1/bundles`, headers `{ 'content-type': 'application/octet-stream', authorization: 'Bearer <token>' }`, body = raw bytes. Server returns `{ ok, name, version, url, signed, persisted }` or `{ error }` with 401/409/422/503.
- Reads degrade: a missing/corrupt credentials file yields `undefined`, never throws.
- Per-package commands: build = `pnpm --filter <pkg> build`, test = `pnpm --filter <pkg> test`, typecheck = `pnpm --filter <pkg> typecheck`.
- Commit after every task. DRY, YAGNI, TDD.

---

## File Structure

- `packages/builder/src/hubs/bundle-hub.ts` (create) — `publishBundle(registry, token, bytes, signal?)`.
- `packages/builder/src/hubs/index.ts` (modify) — re-export `bundle-hub.js`.
- `packages/builder/test/bundle-hub.test.ts` (create) — publishBundle tests.
- `packages/cli/src/credentials.ts` (create) — token store + `resolveToken`.
- `packages/cli/test/credentials.test.ts` (create) — store + precedence tests.
- `packages/cli/src/run.ts` (modify) — `loginCmd`, `logoutCmd`, `publishCmd`; dispatch + usage; `publish-memory` token swap.
- `packages/cli/test/login.test.ts` (create) — login/logout tests.
- `packages/cli/test/publish.test.ts` (create) — publish command tests.
- `packages/cli/README.md` (modify) — document login/publish.

---

## Task 1: `publishBundle` in @uniqent/builder

**Files:**

- Create: `packages/builder/src/hubs/bundle-hub.ts`
- Modify: `packages/builder/src/hubs/index.ts`
- Test: `packages/builder/test/bundle-hub.test.ts`

**Interfaces:**

- Produces: `publishBundle(registry: string, token: string, bytes: Uint8Array, signal?: AbortSignal): Promise<BundlePublishResult>` where `BundlePublishResult = { ok: boolean; name: string; version: string; url?: string; signed?: boolean; persisted?: boolean }`. Throws `Error(json.error ?? '<status> <statusText>')` on non-ok.

- [ ] **Step 1: Write the failing test**

Create `packages/builder/test/bundle-hub.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishBundle } from '../src/hubs/bundle-hub.js';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
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
    const res = await publishBundle('https://uniqent.ai/', 'unq_live_abc', bytes);

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
    stubFetch(409, { error: 'namespace owned by another publisher' });
    await expect(publishBundle('https://uniqent.ai', 't', new Uint8Array())).rejects.toThrow(
      'namespace owned by another publisher',
    );
  });

  it('requires a token', async () => {
    await expect(publishBundle('https://uniqent.ai', '', new Uint8Array())).rejects.toThrow(
      /token/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/builder test -- bundle-hub`
Expected: FAIL — cannot resolve `../src/hubs/bundle-hub.js` (module missing).

- [ ] **Step 3: Implement `bundle-hub.ts`**

Create `packages/builder/src/hubs/bundle-hub.ts`:

```typescript
/**
 * Publish a packed .uniqent bundle to a hosted registry's `POST /api/v1/bundles`
 * (bearer-token gated). `registry` is the SITE base (e.g. https://uniqent.ai), not an
 * index.json URL. The server runs its trust gate (validate + secret-scan + verify) and
 * records ownership. Throws with the server's message on failure.
 */
const base = (b: string) => b.replace(/\/+$/, '');

export interface BundlePublishResult {
  ok: boolean;
  name: string;
  version: string;
  url?: string;
  signed?: boolean;
  persisted?: boolean;
}

export async function publishBundle(
  registry: string,
  token: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<BundlePublishResult> {
  if (!token) throw new Error('a publish token is required');
  const res = await fetch(`${base(registry)}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: bytes,
    ...(signal ? { signal } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<BundlePublishResult> & {
    error?: string;
  };
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return {
    ok: json.ok ?? true,
    name: json.name ?? '',
    version: json.version ?? '',
    url: json.url,
    signed: json.signed,
    persisted: json.persisted,
  };
}
```

- [ ] **Step 4: Re-export from the hubs barrel**

In `packages/builder/src/hubs/index.ts`, add alongside the existing exports:

```typescript
export * from './bundle-hub.js';
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @uniqent/builder test -- bundle-hub && pnpm --filter @uniqent/builder typecheck`
Expected: PASS (3 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/builder/src/hubs/bundle-hub.ts packages/builder/src/hubs/index.ts packages/builder/test/bundle-hub.test.ts
git commit -m "feat(builder): publishBundle for POST /api/v1/bundles"
```

---

## Task 2: Credential store + `resolveToken`

**Files:**

- Create: `packages/cli/src/credentials.ts`
- Test: `packages/cli/test/credentials.test.ts`

**Interfaces:**

- Produces:
  - `loadToken(registry: string): Promise<string | undefined>`
  - `saveToken(registry: string, token: string): Promise<void>`
  - `clearToken(registry: string): Promise<boolean>`
  - `resolveToken(opts: { flag?: string | true; registry: string }): Promise<string | undefined>`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/credentials.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/cli test -- credentials`
Expected: FAIL — cannot resolve `../src/credentials.js`.

- [ ] **Step 3: Implement `credentials.ts`**

Create `packages/cli/src/credentials.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @uniqent/cli test -- credentials && pnpm --filter @uniqent/cli typecheck`
Expected: PASS (6 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/credentials.ts packages/cli/test/credentials.test.ts
git commit -m "feat(cli): per-registry credential store + resolveToken"
```

---

## Task 3: `login` / `logout` commands

**Files:**

- Modify: `packages/cli/src/run.ts`
- Test: `packages/cli/test/login.test.ts`

**Interfaces:**

- Consumes: `saveToken`, `clearToken` (Task 2); `CliIo` (existing: `{ log, error, prompt? }`); `DEFAULT_HUB` (existing const in run.ts).
- Produces: `loginCmd(args: string[], io: CliIo): Promise<number>`, `logoutCmd(args: string[], io: CliIo): Promise<number>`; `run()` routes `login`/`logout`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/login.test.ts`:

```typescript
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
    const code = await run(
      ['login'],
      io(async () => 'unq_live_prompted'),
    );
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/cli test -- login`
Expected: FAIL — `run(['login', …])` hits the usage fallthrough and returns 1 (and stores nothing), so the `loadToken` assertions fail.

- [ ] **Step 3: Add the imports + commands to `run.ts`**

At the top of `packages/cli/src/run.ts`, add to the imports:

```typescript
import { saveToken, clearToken, resolveToken } from './credentials.js';
```

Add these two functions near `publishMemoryCmd` (which is where `DEFAULT_HUB` is defined):

```typescript
async function loginCmd(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args);
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
  let token = typeof flags.token === 'string' ? flags.token : undefined;
  if (!token) {
    if (!io.prompt) {
      io.error('login: provide --token <value> (non-interactive)');
      return 1;
    }
    token = (
      await io.prompt(`Paste a publish token (create one at ${registry}/account/tokens): `)
    ).trim();
  }
  if (!token) {
    io.error('login: no token provided');
    return 1;
  }
  await saveToken(registry, token);
  io.log(`Saved token for ${registry}.`);
  return 0;
}

async function logoutCmd(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args);
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
  const had = await clearToken(registry);
  io.log(had ? `Logged out of ${registry}.` : `No token stored for ${registry}.`);
  return 0;
}
```

- [ ] **Step 4: Route the commands in `run()`**

In the `run()` dispatcher in `run.ts`, add these lines before the `publish-memory` line:

```typescript
if (cmd === 'login') return loginCmd(rest, io);
if (cmd === 'logout') return logoutCmd(rest, io);
```

Also add a usage line (after the `publish-memory` usage `io.error(...)` block):

```typescript
io.error('  login [--registry <site>] [--token <t>]    logout [--registry <site>]');
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @uniqent/cli test -- login && pnpm --filter @uniqent/cli typecheck`
Expected: PASS (4 tests), typecheck clean.

> Note: `resolveToken` is imported here even though `loginCmd`/`logoutCmd` don't use it — it is consumed by Tasks 4 and 5 in the same file. If your linter flags it as unused at this step, that is expected and resolved by Task 4; leave the import.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/run.ts packages/cli/test/login.test.ts
git commit -m "feat(cli): uniqent login/logout commands"
```

---

## Task 4: `publish` command (brain bundles)

**Files:**

- Modify: `packages/cli/src/run.ts`
- Test: `packages/cli/test/publish.test.ts`

**Interfaces:**

- Consumes: `publishBundle` (Task 1, from `@uniqent/builder`); `resolveToken` (Task 2); existing run.ts helpers `maybeSign`, `readDir`, `packBundle` (the `pack` import alias), `DEFAULT_HUB`, `parseArgs`.
- Produces: `publishCmd(args: string[], io: CliIo): Promise<number>`; `run()` routes `publish`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/publish.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/cli test -- publish`
Expected: FAIL — `run(['publish', …])` hits usage fallthrough (returns 1, no fetch), so the 200-path assertions fail.

- [ ] **Step 3: Add `publishBundle` to the builder import + implement `publishCmd`**

In `packages/cli/src/run.ts`, add `publishBundle` to the existing `@uniqent/builder` import block (the one that already imports `publishMemoryPack`, `Brain`, etc.):

```typescript
  publishMemoryPack,
  publishBundle,
```

Add the command near `publishMemoryCmd`:

```typescript
/** Publish a packed .uniqent (or a dir, packed on the fly) to a hosted registry. */
async function publishCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const target = positionals[0];
  if (!target) {
    io.error('publish: missing <file.uniqent|dir>');
    return 1;
  }
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
  const token = await resolveToken({ flag: flags.token, registry });
  if (!token) {
    io.error('publish: not logged in — run `uniqent login` (or pass --token <t>)');
    return 1;
  }

  let bytes: Uint8Array;
  try {
    const isDir = await stat(target)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (isDir) {
      const bundle = await maybeSign(await readDir(target), flags, io);
      bytes = await packBundle(bundle); // validates + secret-scans
    } else {
      bytes = new Uint8Array(await readFile(target));
    }
  } catch (e) {
    io.error(`publish: cannot read ${target}: ${(e as Error).message}`);
    return 1;
  }

  try {
    const r = await publishBundle(registry, token, bytes);
    io.log(
      `published ${r.name}@${r.version}${r.signed ? ' (signed)' : ''}${r.persisted === false ? ' (stored, not indexed)' : ''}${r.url ? ` → ${r.url}` : ''}`,
    );
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    if (/unauthorized|\b401\b/i.test(msg)) {
      io.error('publish: not logged in — run `uniqent login` (or pass --token <t>)');
    } else if (/owned by another publisher/i.test(msg)) {
      io.error(`publish: ${msg}`);
    } else if (/sign|unsigned|signature|secret|trust|verif/i.test(msg)) {
      io.error(`publish: ${msg} — pack and sign it: \`uniqent pack <dir> --sign\``);
    } else {
      io.error(`publish: ${msg}`);
    }
    return 1;
  }
}
```

- [ ] **Step 4: Route `publish` in `run()`**

In the `run()` dispatcher, add before the `publish-memory` line:

```typescript
if (cmd === 'publish') return publishCmd(rest, io);
```

Add a usage line after the `publish-memory` usage line:

```typescript
io.error('  publish <file.uniqent|dir> [--registry <site>] [--token <t>] [--sign|--key <k>]');
```

Also add `publish`, `login`, `logout` into the top-level usage summary string (the first `io.error('usage: uniqent <…>')`): change the command list to
`<try|inspect|install|validate|pack|publish|search|hub|export|import-vault|login|logout|publish-memory|keygen|sign>`.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @uniqent/cli test -- publish && pnpm --filter @uniqent/cli typecheck`
Expected: PASS (5 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/run.ts packages/cli/test/publish.test.ts
git commit -m "feat(cli): uniqent publish for brain bundles"
```

---

## Task 5: `publish-memory` uses the stored token + README

**Files:**

- Modify: `packages/cli/src/run.ts` (publish-memory token lookup)
- Modify: `packages/cli/README.md`
- Test: `packages/cli/test/login.test.ts` (add one case)

**Interfaces:**

- Consumes: `resolveToken` (Task 2), already imported in run.ts by Task 3.

- [ ] **Step 1: Write the failing test**

`publish-memory` requires a pack **file** positional (it does not accept inline `--text`), so the test writes a temp `.json` pack and points at it.

First, extend the existing imports at the top of `packages/cli/test/login.test.ts`:

- add `writeFile` to the `node:fs/promises` import (currently `import { mkdtemp, rm } from 'node:fs/promises';` → `import { mkdtemp, rm, writeFile } from 'node:fs/promises';`),
- add a vitest import line: `import { vi } from 'vitest';`.

Then append this new `describe` block to the file (it reuses the file's existing `run`, `io`, `dir`, `out`, `err`, and the `beforeEach`/`afterEach` that set `UNIQENT_CONFIG_DIR`):

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/cli test -- login`
Expected: FAIL — `publish-memory` currently reads only `flags.token`/`UNIQENT_PUBLISH_TOKEN`, so with neither set it errors "missing --token" and returns 1 before fetch.

- [ ] **Step 3: Swap the token lookup in `publishMemoryCmd`**

In `packages/cli/src/run.ts`, inside `publishMemoryCmd`, replace:

```typescript
const token = typeof flags.token === 'string' ? flags.token : process.env.UNIQENT_PUBLISH_TOKEN;
if (!token) {
  io.error('publish-memory: missing --token <value> (or set UNIQENT_PUBLISH_TOKEN)');
  return 1;
}
const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
```

with (resolve the registry first, then the token via the shared precedence):

```typescript
const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
const token = await resolveToken({ flag: flags.token, registry });
if (!token) {
  io.error('publish-memory: not logged in — run `uniqent login` (or pass --token <t>)');
  return 1;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @uniqent/cli test && pnpm --filter @uniqent/cli typecheck`
Expected: PASS (all cli tests including the new publish-memory case), typecheck clean.

- [ ] **Step 5: Update the README**

In `packages/cli/README.md`, find the publish/memory section and add (or update) a short "Authentication" subsection. Insert this Markdown near the publish docs:

````markdown
## Publishing (requires login)

Publishing is per-user. Create a token at <https://uniqent.ai/account/tokens>, then:

```bash
uniqent login                 # paste your token (stored in ~/.uniqent/credentials.json)
uniqent publish ./my-brain    # packs (optionally --sign) and uploads the .uniqent
uniqent publish-memory notes.md --slug team-playbook --name "Team playbook"
uniqent logout
```
````

Token resolution order: `--token` flag → `UNIQENT_PUBLISH_TOKEN` env → stored login.
`uniqent publish` accepts a packed `.uniqent` file or a directory (packed on the fly;
add `--sign` or `--key <file>` to sign). The registry rejects unsigned/secret-bearing
bundles, and a name owned by another publisher returns a conflict.

````

(Adjust surrounding prose if the README already has a publish section — keep it consistent, don't duplicate.)

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/run.ts packages/cli/README.md packages/cli/test/login.test.ts
git commit -m "feat(cli): publish-memory uses stored token; document login/publish"
````

---

## Notes for the implementer

- **Run tests per package** with pnpm filters (`pnpm --filter @uniqent/cli test`); the `-- <name>` passes a Vitest name filter. Run the full `pnpm --filter @uniqent/cli test` once before the final commit of each task.
- **ESM `.js` imports:** every new relative import needs the `.js` suffix or `node16` resolution + the build will fail. Mirror the existing files.
- **Don't touch** install/search/inspect/pack internals beyond calling `maybeSign`/`packBundle`/`readDir` from `publishCmd`.
- **No release:** publishing the bumped CLI to npm is a separate manual step, out of scope here.
- The server side (token mint + `authPublisher`) lives in the `uniqent-ai` repo and is already done; this plan only consumes its HTTP contract.

```

```
