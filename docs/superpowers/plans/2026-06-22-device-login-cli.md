# Device-Login (CLI Side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `uniqent login` (no `--token`) run the browser device-authorization flow against the registry: get a code, open the browser, poll, and store the returned token — so the user is logged in without copy/paste.

**Architecture:** A pure, dependency-injected `runDeviceLogin` in `packages/cli/src/device.ts` (injected `fetch`/`open`/`sleep`) does start → print code + open browser → poll → return token. `loginCmd` delegates to it when no `--token` is given; `--token` still stores directly. The registry endpoints (`/api/v1/device/{start,poll}`) already exist.

**Tech Stack:** TypeScript (ESM, `node16` — `.js` import suffixes), pnpm monorepo, Vitest (`test/**/*.test.ts`), Node built-ins (`node:child_process`).

## Global Constraints

- `uniqent` monorepo, branch `feat/device-login`. Commit there.
- ESM: relative imports use a `.js` suffix.
- Registry endpoints consumed: `POST {base}/api/v1/device/start` → `{ device_code, user_code, verify_url, interval, expires_in }`; `POST {base}/api/v1/device/poll { device_code }` → `{ status: 'pending'|'approved'|'expired', token? }`. `base` strips a trailing slash.
- Default registry `DEFAULT_HUB = 'https://uniqent.ai'` (already in `run.ts`).
- The flow is fully dependency-injected for tests: `fetchImpl` (default global `fetch`), `open` (default OS opener that no-ops when `!process.stdout.isTTY`), `sleep` (default `setTimeout`).
- Token is stored via the existing `saveToken(registry, token)` from `./credentials.js`.
- `--token` remains the explicit paste/store fallback; `logout` unchanged.
- Per-package commands: `pnpm --filter @uniqent/cli test` (use `-- <name>` filter), `pnpm --filter @uniqent/cli typecheck`. Run `pnpm --filter @uniqent/builder build` first if a CLI typecheck complains about builder types (stale dist).
- Commit after every task. DRY, YAGNI, TDD.

---

## File Structure

- `packages/cli/src/device.ts` (create) — `runDeviceLogin` + default opener/sleep.
- `packages/cli/test/device.test.ts` (create) — device-flow unit tests.
- `packages/cli/src/run.ts` (modify) — `loginCmd` runs the device flow when no `--token`.
- `packages/cli/test/login.test.ts` (modify) — device-path test.
- `packages/cli/README.md` (modify) — document `uniqent login` browser flow.

---

## Task 1: `runDeviceLogin` device-flow module

**Files:**
- Create: `packages/cli/src/device.ts`
- Test: `packages/cli/test/device.test.ts`

**Interfaces:**
- Produces:
  - `interface DeviceLoginDeps { registry: string; io: { log: (m: string) => void; error: (m: string) => void }; fetchImpl?: typeof fetch; open?: (url: string) => void; sleep?: (ms: number) => Promise<void> }`
  - `runDeviceLogin(deps: DeviceLoginDeps): Promise<string | null>` — returns the token, or `null` on failure/expiry/timeout.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/device.test.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/cli test -- device`
Expected: FAIL — cannot resolve `../src/device.js`.

- [ ] **Step 3: Implement `device.ts`**

```typescript
import { spawn } from 'node:child_process';

export interface DeviceLoginDeps {
  registry: string;
  io: { log: (m: string) => void; error: (m: string) => void };
  fetchImpl?: typeof fetch;
  open?: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

interface StartResponse {
  device_code: string;
  user_code: string;
  verify_url: string;
  interval?: number;
  expires_in?: number;
}
interface PollResponse {
  status: 'pending' | 'approved' | 'expired';
  token?: string;
}

const base = (b: string) => b.replace(/\/+$/, '');

/** Open a URL in the OS browser. No-op when not a TTY (the URL was already printed). */
function defaultOpenUrl(url: string): void {
  if (!process.stdout.isTTY) return;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* opening is best-effort; the URL is printed regardless */
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run the browser device-authorization flow. Returns the publish token, or null on failure/expiry/timeout. */
export async function runDeviceLogin(deps: DeviceLoginDeps): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const open = deps.open ?? defaultOpenUrl;
  const sleep = deps.sleep ?? defaultSleep;
  const b = base(deps.registry);

  const startRes = await fetchImpl(`${b}/api/v1/device/start`, { method: 'POST' });
  if (!startRes.ok) {
    deps.io.error(`login: device start failed (${startRes.status})`);
    return null;
  }
  const start = (await startRes.json()) as StartResponse;

  deps.io.log(`\nTo authorize this device, visit:\n  ${start.verify_url}\nand confirm the code:  ${start.user_code}\n`);
  open(start.verify_url);

  const deadline = Date.now() + (start.expires_in ?? 600) * 1000;
  const intervalMs = (start.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const pollRes = await fetchImpl(`${b}/api/v1/device/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: start.device_code }),
    });
    const poll = (await pollRes.json()) as PollResponse;
    if (poll.status === 'approved' && poll.token) return poll.token;
    if (poll.status === 'expired') {
      deps.io.error('login: the code expired or was not approved.');
      return null;
    }
    // pending → keep polling
  }
  deps.io.error('login: timed out waiting for approval.');
  return null;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @uniqent/cli test -- device && pnpm --filter @uniqent/cli typecheck`
Expected: PASS (3 device tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/device.ts packages/cli/test/device.test.ts
git commit -m "feat(cli): runDeviceLogin browser device-authorization flow"
```

---

## Task 2: wire `loginCmd` to the device flow + docs

**Files:**
- Modify: `packages/cli/src/run.ts`
- Modify: `packages/cli/test/login.test.ts`
- Modify: `packages/cli/README.md`

**Interfaces:**
- Consumes: `runDeviceLogin` (Task 1); `saveToken` (already imported in run.ts); `DEFAULT_HUB`, `parseArgs`, `CliIo`.

- [ ] **Step 1: Update the existing tests, then write the failing device test**

First, the behavior of `login` with no `--token` changes (it now runs the device flow instead of prompting/erroring), so **remove two now-obsolete cases** from `packages/cli/test/login.test.ts`:
- the test titled **"prompts for the token when interactive and none is passed"** (there is no more paste prompt), and
- the test titled **"errors when non-interactive with no --token"** (no-token no longer errors).

Keep the "stores a token passed via --token" and "logout clears the stored token" cases. Then add a new `describe` (the file already imports `run`, has the `io()` factory, the temp `UNIQENT_CONFIG_DIR` `beforeEach/afterEach`, and `loadToken`; add `vi` to the vitest import if not present):

```typescript
describe('login (device flow)', () => {
  it('runs the browser device flow when no --token and stores the returned token', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ device_code: 'dc', user_code: 'AAAA-BBBB', verify_url: 'https://uniqent.ai/device?code=AAAA-BBBB', interval: 0, expires_in: 600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'approved', token: 'unq_live_device' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchFn);
    try {
      const code = await run(['login'], io()); // no --token, no prompt → device flow
      expect(code).toBe(0);
      expect(await loadToken('https://uniqent.ai')).toBe('unq_live_device');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

(`open` won't launch a browser here: Vitest runs without a TTY, so the default opener no-ops. `interval: 0` makes the default sleep instant.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/cli test -- login`
Expected: FAIL — current `loginCmd` with no `--token` and no `io.prompt` errors with "provide --token" and returns 1; no token stored.

- [ ] **Step 3: Rewrite `loginCmd` in `run.ts`**

Add the import near the other local imports:

```typescript
import { runDeviceLogin } from './device.js';
```

Replace the existing `loginCmd` with:

```typescript
async function loginCmd(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args);
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;

  // Explicit paste/store path.
  if (typeof flags.token === 'string') {
    if (!flags.token) {
      io.error('login: empty --token');
      return 1;
    }
    await saveToken(registry, flags.token);
    io.log(`Saved token for ${registry}.`);
    return 0;
  }

  // Default: browser device-authorization flow.
  const token = await runDeviceLogin({ registry, io });
  if (!token) return 1; // runDeviceLogin already printed the reason
  await saveToken(registry, token);
  io.log(`Logged in to ${registry}.`);
  return 0;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @uniqent/builder build && pnpm --filter @uniqent/cli test && pnpm --filter @uniqent/cli typecheck`
Expected: all CLI tests pass (device + login + the rest), typecheck clean.

- [ ] **Step 5: Update the README**

In `packages/cli/README.md`, update the "Publishing (requires login)" section so the `uniqent login` line describes the browser flow:

```markdown
`uniqent login` opens your browser to approve the device (sign in with your
uniqent.ai account), then stores the returned token in `~/.uniqent/credentials.json`.
On a headless machine it prints the URL + code to open elsewhere. You can still pass a
token directly with `uniqent login --token <unq_live_…>` (create one at
<https://uniqent.ai/account/tokens>).
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/run.ts packages/cli/test/login.test.ts packages/cli/README.md
git commit -m "feat(cli): uniqent login uses the browser device flow"
```

---

## Notes for the implementer

- **No browser in tests:** the default opener no-ops without a TTY, and `interval: 0` from the stubbed start response makes the default sleep instant — so the device path is fully unit-testable with just a stubbed global `fetch`.
- **ESM `.js` suffixes** on every relative import.
- **The registry endpoints** (`/api/v1/device/{start,poll}`) live in the `uniqent-ai` repo (branch `feat/device-login`) and must be deployed for the live flow; this plan only consumes their HTTP contract.
- **Human-gated E2E** (cannot be automated): deploy the registry, run `uniqent login`, click Approve in the Clerk browser, confirm the token is stored and `uniqent publish` works.
