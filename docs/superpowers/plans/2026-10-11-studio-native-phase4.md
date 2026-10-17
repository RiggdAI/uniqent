# Studio Native — Phase 4 (install, capture, native, ship) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Studio.app installs a brain into Claude Code / Hermes / OpenClaw, captures an existing agent back into the canvas, opens/saves `.uniqent` files and accepts drag-and-drop — all without the Node server, which is deleted — and a tagged GitHub Actions run ships a universal macOS DMG.

**Architecture:** Each adapter is split into a pure, browser-safe core (`inputs`/`plan`/`translate`, `captureInputs`/`capture`) behind an `@uniqent/adapter-*/pure` subpath, and a thin Node wrapper (read → pure → write) that the CLI keeps using unchanged. Studio's web UI runs the same pure core; Rust does every read and write (`read_inputs`/`write_outputs`) confined to a root the user picked or a known framework home, with atomic temp+rename writes and 0600 for secret files. Golden fixtures produced by the real CLI pin byte-identical output for both paths.

**Tech Stack:** TypeScript (ESM), Zod 4, Vitest 5, `yaml` 2 / `json5` 2 (both ship browser builds), Tauri 2.12 + `tauri-plugin-dialog` + `tauri-plugin-http`, Rust, GitHub Actions (macOS runner).

**Spec:** `docs/superpowers/specs/2026-09-28-studio-native-ship-design.md` (section "Sub-project 3 — Phase 4: install, capture, native, ship")

## Global Constraints

- Rust owns all file I/O, path confinement, file modes, dialogs and the session; the webview never touches the filesystem (no general fs plugin) and never decides which folders are allowed.
- Pure modules (`@uniqent/core/pure`, `@uniqent/builder/{hubs,memory,brain}`, `@uniqent/adapter-sdk/pure`, `@uniqent/adapter-{claude-code,hermes,openclaw}/pure`) must not import `node:*` or use `Buffer`/`process` anywhere in their module graph (guarded by `packages/builder/test/pure-entries.test.ts` and ESLint).
- The `Adapter` interface (`detect/plan/apply/export`) and the CLI's behaviour stay **byte-identical**: every existing adapter, conformance and CLI test passes unchanged, and the Task 1 golden trees (produced by today's CLI before any refactor) keep matching.
- Secrets: credential values exist only in the install form's React state, the pure `translate` call and the bytes handed to `write_outputs`; they are never logged, never in an error message, never in a bundle. Rust errors name paths, never content.
- No silent loss: lossiness is shown in full (action, component, issue) before any write; anything `load_bundle` cannot hold is reported in `dropped`; capture reports how many episodic/personal items it scrubbed.
- No default parameter values; every function parameter explicit; no flag parameters that switch behaviour (options objects may carry data). Errors explicit and specific (path, field, status).
- Golden fixtures (`apps/studio/fixtures/**`) keep passing in TS and Rust; regenerate only with the named `fixtures:*` script when a behaviour intentionally changes, and review the diff.
- Commit at each task's final step; conventional commits ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Gates (**the gates**): `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && (cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings)`

## Review Focus

- A hostile bundle path (`skills/x/../../../evil.md`) must throw `PathEscapeError` in the **pure** layer before anything is read or written, in the CLI and in Studio — pinned by the existing adapter hardening tests (Tasks 3–5) and a Rust test (Task 6).
- Studio asked to write into a folder the user did not pick and that is not a framework home (e.g. `~/.ssh`) must be refused by Rust — pinned in Task 6.
- A symlink anywhere under the root (`~/.hermes/memories -> /etc`, or a symlinked `AGENTS.md`) must make the write fail with nothing written outside the root — pinned in Task 6.
- An existing `.env` / `.mcp.json` with mode 0644 must end up 0600 when it receives secrets; a non-secret existing file keeps its mode — pinned in Task 6 and by the `ownerOnly` flags in the Task 7 parity fixtures.
- The same bundle installed via the CLI and via Studio's path (pure translate → Rust `write_outputs`) must give byte-identical trees for all three targets — pinned by Tasks 1 + 7.
- Capturing a colleague's agent must never load episodic or `personal` memory into the session — pinned in Tasks 2 and 10.
- Opening a `.uniqent` whose signature no longer matches must be refused — pinned in Task 8.
- No localhost port remains and the CSP is not `null` — pinned in Tasks 11 and 12.

---

### Task 1: Golden install + capture trees from today's CLI

Captures the CLI's current output **before** any adapter refactor, so Tasks 3–5 can prove "byte-identical".

**Files:**

- Create: `apps/studio/scripts/emit-install-fixtures.ts`
- Create: `apps/studio/fixtures/install/claude-code.json`, `hermes.json`, `openclaw.json` (generated)
- Create: `apps/studio/test/install-fixtures.test.ts`
- Modify: `apps/studio/package.json` (devDependency `"@uniqent/cli": "workspace:^"`, script `"fixtures:install": "tsx scripts/emit-install-fixtures.ts && prettier --write fixtures/install"`), `pnpm-lock.yaml`

**Interfaces:**

- Produces (exported from the script, consumed by the test and by Task 7):

```ts
export type FixtureTarget = 'claude-code' | 'hermes' | 'openclaw';

/** One target's golden install/capture, all paths POSIX and relative to the install root. */
export interface InstallFixture {
  target: FixtureTarget;
  /** Files present before the install (path → UTF-8 text). Seeds exercise every merge path. */
  seed: Record<string, string>;
  /** Dummy credential values passed as `--cred ref=value` (not secret-shaped). */
  credentials: Record<string, string>;
  /** Every file after `uniqent install` (path → bytes, and whether its mode is owner-only). */
  tree: Record<string, { bytesBase64: string; ownerOnly: boolean }>;
  /** `uniqent export --from <target>` of that tree: bundle path → base64 bytes. */
  captured: Record<string, string>;
}

export function fixtureBundle(): Bundle;
export function buildInstallFixture(target: FixtureTarget): Promise<InstallFixture>;
```

Seeds are stored inside the JSON (not as files) because the repo `.gitignore` ignores `.env` and `*.uniqent`.

- [ ] **Step 1: Write the failing test**

`apps/studio/test/install-fixtures.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInstallFixture, type FixtureTarget } from '../scripts/emit-install-fixtures.js';

const committed = (t: FixtureTarget) =>
  JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'install', `${t}.json`), 'utf8'),
  ) as unknown;

describe('the CLI still produces the golden install + capture trees', () => {
  for (const target of ['claude-code', 'hermes', 'openclaw'] as const) {
    it(target, async () => {
      expect(await buildInstallFixture(target)).toEqual(committed(target));
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run apps/studio/test/install-fixtures.test.ts`
Expected: FAIL — the script and fixture files do not exist.

- [ ] **Step 3: Write the emitter (drives the real CLI `run()`)**

`apps/studio/scripts/emit-install-fixtures.ts` (same "run only when executed directly" pattern as `emit-core-fixtures.ts`):

- `fixtureBundle()` builds with `Brain.create({ name: 'parity-brain', displayName: 'Parity Brain', version: '0.1.0', description: 'Install parity fixture', author: { name: 'fixture' }, license: 'CC0-1.0', tags: [] })` and adds: persona, policies, profile `{ name: 'Ada', role: 'Lead' }`, three facts with ids/`createdAt: '2026-05-31T00:00:00.000Z'`/importances 1, 0.5, 0, one `episodic` item, skill `triage` with an extra binary file (`addSkill('triage', md, { 'assets/logo.bin': new Uint8Array([0, 255, 1, 128]) })`), `addMcpFromCatalog('github')`, `addChannelFromCatalog('telegram')`, one schedule task. Deterministic: no `Date.now()`.
- Seeds (exercise the merges):
  - claude-code: `AGENTS.md` with user text, `CLAUDE.md` with user text, `.mcp.json` with an unrelated `other` server.
  - hermes: `config.yaml` with a comment and an unrelated key, `.env` with `EXISTING=1`, `memories/MEMORY.md` with two entries joined by `\n§\n`, `SOUL.md`.
  - openclaw: JSON5 `openclaw.json` with a comment and an unrelated key, `.env` with `EXISTING=1`, `workspace/SOUL.md` with user text.
- `buildInstallFixture(target)`: `mkdtemp` a root, write the seed, `pack(fixtureBundle())` to a temp `parity.uniqent`, then call the CLI's exported `run` (`import { run } from '@uniqent/cli'`) with a collecting `CliIo` (`{ log, error }`, no prompts):

```ts
const credentials = Object.fromEntries(
  fixtureBundle()
    .manifest()
    .credentials.map((c) => [c.ref, `test-${c.ref}`]),
);
const credArgs = Object.entries(credentials).flatMap(([ref, v]) => ['--cred', `${ref}=${v}`]);
const code = await run(
  [
    'install',
    bundleFile,
    '--target',
    target,
    '--root',
    root,
    '--allow-unsigned',
    '--yes',
    ...credArgs,
  ],
  io,
);
if (code !== 0) throw new Error(`uniqent install --target ${target} failed:\n${lines.join('\n')}`);
```

Snapshot the root: every regular file (sorted POSIX paths) → `{ bytesBase64, ownerOnly: (mode & 0o077) === 0 }`. Then `run(['export', '--from', target, '--root', root, '--out', capturedFile], io)` (fail loudly on non-zero), `unpack` it with `@uniqent/core`, and store `captured` as path → base64. Remove the temp dirs in `finally`.

- When run directly: write `fixtures/install/<target>.json` for all three targets.

- [ ] **Step 4: Add the dependency and generate**

Run: `pnpm install && pnpm build && pnpm --filter @uniqent/studio fixtures:install`
Expected: three JSON files written; `git diff --stat` shows only the new files, `package.json` and `pnpm-lock.yaml`.

Inspect each fixture by eye: `tree` contains the seed files merged (e.g. hermes `config.yaml` still has the comment, `.env` has `EXISTING=1` and `ownerOnly: true`), and `captured` contains no credential values (`grep -c test- apps/studio/fixtures/install/*.json` hits only `credentials`, `.env`/`.mcp.json` tree entries are base64 so check by decoding one).

- [ ] **Step 5: Run the test, then the gates**

Run: `pnpm vitest run apps/studio/test/install-fixtures.test.ts`, then the gates.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(studio): golden CLI install + capture trees for all three targets" -m "Recorded from today's uniqent CLI before the adapter split, so the refactor can prove byte-identical output. Seeds exercise every merge path (managed sections, .mcp.json, config.yaml comments, JSON5, .env)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Pure adapter contract, Node I/O wrapper, browser-safe Brain entry

**Files:**

- Create: `packages/adapter-sdk/src/pure-paths.ts`, `io.ts`, `pure.ts`, `node-io.ts`
- Modify: `packages/adapter-sdk/src/paths.ts` (keep only Node `resolveInside`; `PathEscapeError` imported from `pure-paths.ts`), `credentials.ts` (gains `requiredCredentialRefs`, moved verbatim from `paths.ts`; `import type { Bundle } from '@uniqent/core/pure'`), `types.ts` (`import type { Bundle } from '@uniqent/core/pure'`), `index.ts` (re-export everything, unchanged public names), `package.json` (`exports["./pure"]`; dependency `"@uniqent/builder": "workspace:^"` for `scrubPrivateMemory` in `node-io.ts`)
- Create: `packages/builder/src/brain-entry.ts`, `packages/builder/src/scrub.ts`, `packages/builder/src/detect-markers.ts`
- Modify: `packages/builder/src/brain.ts` (import `Bundle, PATHS, validateBundle` and types from `@uniqent/core/pure`), `detect.ts` (use `projectTargets`), `index.ts` (export `scrub.js`, `detect-markers.js`), `package.json` (`exports["./brain"]`)
- Modify: `packages/cli/src/targets.ts` (`nextStep` moves to `detect-markers.ts`; `targets.ts` keeps `export { nextStep } from '@uniqent/builder'` so `run.ts` and `test/targets.test.ts` are unchanged)
- Modify: `eslint.config.js` (pure file globs), `packages/builder/test/pure-entries.test.ts` (new entries), `pnpm-lock.yaml`
- Test: `packages/adapter-sdk/test/pure.test.ts`, `packages/adapter-sdk/test/node-io.test.ts`, `packages/builder/test/scrub.test.ts`

**Interfaces:**

- Produces `@uniqent/adapter-sdk/pure` (also re-exported from `.`):

```ts
// io.ts
/** A file location: an absolute base directory and a POSIX path relative to it. */
export interface FileRef {
  root: string;
  path: string;
}
/** Every file named `fileName` under `root/dir` at any depth; dot dirs and `skipDirs` are skipped, symlinks never followed. */
export interface FindRef {
  root: string;
  dir: string;
  fileName: string;
  skipDirs: string[];
}
export interface InputRequest {
  files: FileRef[];
  finds: FindRef[];
}
/** Bytes read so far, keyed by `joinPath(root, path)`. A requested file that does not exist is absent. */
export type ReadFiles = ReadonlyMap<string, Uint8Array>;
export type ReadFn = (request: InputRequest) => Promise<ReadFiles>;

/** Mode for files holding resolved secrets. `null` keeps an existing file's mode (new files: 0666 & ~umask). */
export const OWNER_ONLY = 0o600;
export interface OutputWrite extends FileRef {
  bytes: Uint8Array;
  mode: typeof OWNER_ONLY | null;
}

/** Absolute paths an adapter resolves against. `home` expands `~`; `cwd` resolves relative config paths. */
export interface TargetContext {
  root: string;
  home: string;
  cwd: string;
}

export interface Translation {
  plan: InstallPlan;
  /** In write order; the CLI prints them in this order. */
  writes: OutputWrite[];
  /** Exactly the `InstallResult.notes` apply() returns today. */
  notes: string[];
}

/** One framework target's pure logic, shared verbatim by the CLI (Node) and Studio (webview). */
export interface PureAdapter {
  id: string;
  displayName: string;
  inputs(bundle: Bundle, read: ReadFiles, ctx: TargetContext): InputRequest;
  plan(bundle: Bundle, read: ReadFiles, ctx: TargetContext): InstallPlan;
  translate(
    bundle: Bundle,
    read: ReadFiles,
    resolved: ResolvedCredentials,
    ctx: TargetContext,
  ): Translation;
  captureInputs(read: ReadFiles, ctx: TargetContext): InputRequest;
  capture(read: ReadFiles, ctx: TargetContext): Bundle;
}

/** The adapter kept asking for new files (OpenClaw needs 2 rounds: openclaw.json, then its workspace). */
export class InputsUnsettledError extends Error {
  constructor(readonly rounds: number) {
    super(`adapter inputs did not settle after ${rounds} read rounds`);
    this.name = 'InputsUnsettledError';
  }
}
export function gatherInputs(
  next: (read: ReadFiles) => InputRequest,
  readFn: ReadFn,
): Promise<ReadFiles>;
/** UTF-8 text of `root/path` (Node `readFile(…, 'utf8')` semantics: invalid bytes → U+FFFD), or undefined if absent. */
export function readText(read: ReadFiles, root: string, path: string): string | undefined;
/** Byte-for-byte equality without `Buffer`: every adapter's "replaces an existing, different file" check. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean;

// pure-paths.ts
export class PathEscapeError extends Error {} // moved verbatim from paths.ts
/** Normalize a relative POSIX path ('.'/'..' folded); PathEscapeError if absolute, contains '\\' or NUL, is empty, or climbs out of `base`. */
export function confineRelative(base: string, path: string): string;
export function joinPath(dir: string, rel: string): string;
/** POSIX `resolve(base, p)` for configured directories (OpenClaw workspace). */
export function resolvePosix(base: string, p: string): string;
/** Root-relative path when the write lies under `root`, else the absolute path (what the CLI prints today). */
export function displayPath(root: string, ref: FileRef): string;

// credentials.ts (existing file, now on the pure surface) — requiredCredentialRefs moved verbatim
// from paths.ts, next to the existing CredentialScopeError, assertMcpCredentialScope,
// EnvReferenceError and assertNoEnvReferences. pure.ts re-exports all of them, so the pure
// adapters (Tasks 3–5) import the scope/env-reference checks from '@uniqent/adapter-sdk/pure'.
```

- Produces (Node only, from `@uniqent/adapter-sdk` `.`):

```ts
export const readFromDisk: ReadFn;
export function writeToDisk(writes: OutputWrite[]): Promise<void>;
export function nodeContext(root: string): TargetContext; // { root: resolve(root), home: homedir(), cwd: process.cwd() }
/** `export()` = pure capture → scrubPrivateMemory (the CLI never exports episodic/personal memory). */
export function nodeAdapter(pure: PureAdapter, detect: Adapter['detect']): Adapter;
```

- Produces `@uniqent/builder/brain` (`brain-entry.ts`): `brain.js`, `derive.js`, `catalog/index.js`, `scrub.js`, `detect-markers.js`:

```ts
export interface ScrubReport {
  episodic: number;
  personal: number;
}
/**
 * Drop episodic and `visibility: "personal"` memory — capture never carries a colleague's private
 * notes. Returns the input bundle itself (same bytes) when there is nothing to remove.
 */
export function scrubPrivateMemory(bundle: Bundle): { bundle: Bundle; removed: ScrubReport };

export type TargetId = 'claude-code' | 'openclaw' | 'hermes'; // moved from detect.ts, re-exported there
export interface TargetGuess {
  id: TargetId;
  configRoot: string;
}
/** Names whose presence in a folder marks a framework project (detectProject's rules). */
export const PROJECT_MARKERS: readonly [
  '.claude',
  '.mcp.json',
  'openclaw.json',
  'config.yaml',
  'SOUL.md',
];
export type ProjectMarker = (typeof PROJECT_MARKERS)[number];
/** Frameworks whose markers are `present` in `dir`; each installs into `dir`. */
export function projectTargets(dir: string, present: ReadonlySet<ProjectMarker>): TargetGuess[];
/** What to do after a successful install into `root` — moved verbatim from packages/cli/src/targets.ts (CLI + Studio share the wording). */
export function nextStep(target: string, root: string): string;
```

- [ ] **Step 1: Write the failing tests**

`packages/adapter-sdk/test/pure.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  confineRelative,
  gatherInputs,
  joinPath,
  InputsUnsettledError,
  PathEscapeError,
  resolvePosix,
  sameBytes,
  type ReadFiles,
} from '../src/pure';

describe('pure paths', () => {
  it('confines relative paths and folds dot segments', () => {
    expect(confineRelative('/r', 'skills/x/SKILL.md')).toBe('skills/x/SKILL.md');
    expect(confineRelative('/r', 'skills/x/../y/SKILL.md')).toBe('skills/y/SKILL.md');
    for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', '', '.', 'a\0b'])
      expect(() => confineRelative('/r', bad), bad).toThrow(PathEscapeError);
  });
  it('joins and resolves POSIX paths', () => {
    expect(joinPath('/h/.hermes/', 'SOUL.md')).toBe('/h/.hermes/SOUL.md');
    expect(resolvePosix('/cwd', 'ws/../ws2')).toBe('/cwd/ws2');
    expect(resolvePosix('/cwd', '/abs/./w')).toBe('/abs/w');
  });
  it('compares bytes', () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
  });
});

describe('gatherInputs', () => {
  it('reads until the adapter asks for nothing new, never re-reading a file', async () => {
    const asked: string[] = [];
    const disk = new Map([
      ['/r/a', new Uint8Array([1])],
      ['/r/b', new Uint8Array([2])],
    ]);
    const read = await gatherInputs(
      (r) => ({
        files: [{ root: '/r', path: 'a' }, ...(r.has('/r/a') ? [{ root: '/r', path: 'b' }] : [])],
        finds: [],
      }),
      async (req) => {
        asked.push(...req.files.map((f) => f.path));
        return new Map(
          req.files.flatMap((f) => {
            const v = disk.get(`${f.root}/${f.path}`);
            return v ? [[`${f.root}/${f.path}`, v] as const] : [];
          }),
        );
      },
    );
    expect([...read.keys()]).toEqual(['/r/a', '/r/b']);
    expect(asked).toEqual(['a', 'b']);
  });
  it('throws InputsUnsettledError when requests never settle', async () => {
    let n = 0;
    await expect(
      gatherInputs(
        () => ({ files: [{ root: '/r', path: `f${n++}` }], finds: [] }),
        async (): Promise<ReadFiles> => new Map(),
      ),
    ).rejects.toThrow(InputsUnsettledError);
  });
});
```

`packages/adapter-sdk/test/node-io.test.ts` (real temp dirs): `readFromDisk` omits absent files, rethrows non-ENOENT errors (read a directory path → EISDIR), finds `SKILL.md` at any depth while skipping `.git`, a `skipDirs` entry and a symlinked dir; `writeToDisk` creates parents, writes `OWNER_ONLY` as 0600 and tightens an existing 0644 file, and leaves an existing 0640 file's mode for `mode: null`.

`packages/builder/test/scrub.test.ts`: a bundle with one shareable fact, one `personal` fact and two episodic items → `removed` is `{ episodic: 2, personal: 1 }`, the result has exactly the shareable fact and still validates; a bundle with only shareable facts → `removed` is `{ episodic: 0, personal: 0 }` and the returned `bundle` is the input object (`toBe`).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uniqent/adapter-sdk build; pnpm vitest run packages/adapter-sdk packages/builder/test/scrub.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the pure modules**

`gatherInputs` (in `io.ts`):

```ts
const MAX_ROUNDS = 4;
const fileKey = (f: FileRef) => joinPath(f.root, f.path);
const findKey = (f: FindRef) =>
  `find:${joinPath(f.root, f.dir)}:${f.fileName}:${f.skipDirs.join(',')}`;

export async function gatherInputs(
  next: (read: ReadFiles) => InputRequest,
  readFn: ReadFn,
): Promise<ReadFiles> {
  const read = new Map<string, Uint8Array>();
  const asked = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const req = next(read);
    const files = req.files.filter((f) => !asked.has(fileKey(f)));
    const finds = req.finds.filter((f) => !asked.has(findKey(f)));
    if (files.length === 0 && finds.length === 0) return read;
    files.forEach((f) => asked.add(fileKey(f)));
    finds.forEach((f) => asked.add(findKey(f)));
    for (const [k, v] of await readFn({ files, finds })) read.set(k, v);
  }
  throw new InputsUnsettledError(MAX_ROUNDS);
}
```

`readText` uses a module-level `new TextDecoder('utf-8')` (non-fatal, same replacement behaviour as Node's `'utf8'`). `sameBytes` compares lengths, then every byte. `pure.ts` re-exports `io.js`, `pure-paths.js` and `credentials.js`. `confineRelative` splits on `/`, folds `.`/`..` on a stack and throws `PathEscapeError(base, path)` (same message as today) when the stack would go below zero; `joinPath` trims trailing `/` from `dir`.

- [ ] **Step 4: Implement the Node wrapper**

`node-io.ts`:

```ts
export function nodeAdapter(pure: PureAdapter, detect: Adapter['detect']): Adapter {
  const gather = (bundle: Bundle, ctx: TargetContext) =>
    gatherInputs((read) => pure.inputs(bundle, read, ctx), readFromDisk);
  return {
    id: pure.id,
    displayName: pure.displayName,
    detect,
    async plan(bundle, { root }) {
      const ctx = nodeContext(root);
      return pure.plan(bundle, await gather(bundle, ctx), ctx);
    },
    async apply(bundle, _plan, resolved, { root }) {
      // Re-read and re-translate against the current disk state (validates before the first write).
      const ctx = nodeContext(root);
      const t = pure.translate(bundle, await gather(bundle, ctx), resolved, ctx);
      await writeToDisk(t.writes);
      return { written: t.writes.map((w) => displayPath(ctx.root, w)), notes: t.notes };
    },
    async export({ root }) {
      const ctx = nodeContext(root);
      const read = await gatherInputs((r) => pure.captureInputs(r, ctx), readFromDisk);
      // Pure capture keeps every memory item it finds; the export never carries private ones.
      return scrubPrivateMemory(pure.capture(read, ctx)).bundle;
    },
  };
}
```

`scrubPrivateMemory` is imported from `@uniqent/builder/brain`. Today only OpenClaw capture can meet episodic items (it skipped them inline; Task 5 moves that to this scrub), so `uniqent export` output is unchanged for all three targets.

`writeToDisk` keeps today's semantics exactly (plain `writeFile`, not atomic — the CLI must stay byte- and mode-identical): `mkdir(dirname, { recursive: true })`, `writeFile(target, bytes)` for `mode: null`; `writeFile(target, bytes, { mode: 0o600 })` + `chmod(target, 0o600)` for `OWNER_ONLY`. `readFromDisk` reads each file (`ENOENT` → absent, anything else rethrown) and walks finds with `readdir(..., { withFileTypes: true })` (Dirents never follow symlinks; skip names starting with `.` and `skipDirs`; `ENOENT` on the start dir → none).

- [ ] **Step 5: Builder pure entry, scrub, detect markers**

- `brain.ts`: change `import { Bundle, PATHS, validateBundle } from '@uniqent/core'` (and the type import) to `@uniqent/core/pure`.
- `scrub.ts`: count the items with `kind === 'episodic'` or `visibility === 'personal'`; none → return `{ bundle, removed }` with the input bundle; else `Brain.fromBundle(bundle)`, `removeMemory` each, `toBundle()`.
- `detect-markers.ts`: move `TargetId`/`TargetGuess` here; `projectTargets` holds `detectProject`'s three rules verbatim; `nextStep` moves here verbatim from `packages/cli/src/targets.ts`, which keeps `export { nextStep } from '@uniqent/builder';` (`packages/cli/test/targets.test.ts` passes untouched). `detect.ts` probes each `PROJECT_MARKERS` entry with its `exists()` and calls `projectTargets(cwd, present)`; `detectTarget`'s signature and behaviour are unchanged (`packages/builder/test/detect.test.ts` must pass untouched).
- `brain-entry.ts`: `export * from './brain.js'; './derive.js'; './catalog/index.js'; './scrub.js'; './detect-markers.js'`. `package.json` adds `"./brain": { "types": "./dist/brain-entry.d.ts", "default": "./dist/brain-entry.js" }`.

- [ ] **Step 6: Extend the import-graph guard and ESLint**

`pure-entries.test.ts`: add `builder/dist/brain-entry.js` and `adapter-sdk/dist/pure.js` to `ENTRIES`; add `'@uniqent/builder/memory'`, `'@uniqent/builder/brain'`, `'@uniqent/adapter-sdk/pure'` to `RESOLVE` (each mapped to its dist file). Third-party bare imports (`zod`, later `yaml`/`json5`) are not walked — both ship browser builds (`yaml` `exports.default → ./browser/index.js`, `json5` `module → dist/index.mjs`, neither touches `process`).

`eslint.config.js` pure block `files` adds:

```js
'packages/adapter-sdk/src/{pure,pure-paths,credentials,io,types}.ts',
'packages/builder/src/{brain,brain-entry,derive,scrub,detect-markers}.ts',
'packages/builder/src/catalog/**/*.ts',
```

- [ ] **Step 7: Run tests and gates**

Run: `pnpm install && pnpm build && pnpm vitest run packages/adapter-sdk packages/builder packages/cli/test/targets.test.ts && pnpm lint`, then the gates.
Expected: PASS, including the unchanged conformance test, `detect.test.ts`, `targets.test.ts` and the Task 1 golden test.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(adapter-sdk): pure adapter contract with a Node read/translate/write wrapper" -m "PureAdapter (inputs/plan/translate/captureInputs/capture) over FileRefs and a gatherInputs fixpoint, browser-safe at @uniqent/adapter-sdk/pure; nodeAdapter() keeps the Adapter interface and the CLI's write semantics. @uniqent/builder/brain exposes Brain, scrubPrivateMemory, the project-marker rules and nextStep without Node APIs." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Hermes adapter split

**Files:**

- Modify: `packages/adapter-hermes/src/translate.ts` (pure; current `translate` becomes private `draft`), `memory.ts` (`stripMemoryMarkup` from `@uniqent/builder/memory`), `index.ts` (Node wrapper + `detect`)
- Create: `packages/adapter-hermes/src/capture.ts` (from `export.ts`), `packages/adapter-hermes/src/pure.ts`
- Delete: `packages/adapter-hermes/src/export.ts`; `fs.ts` keeps only `exists` (used by `detect`)
- Modify: `packages/adapter-hermes/package.json` (`exports["./pure"]`), `eslint.config.js`, `packages/builder/test/pure-entries.test.ts`
- Test: `packages/adapter-hermes/test/translate.test.ts` (pure, no disk); `adapter.test.ts` unchanged

**Interfaces:**

- Consumes: Task 2 contract.
- Produces `@uniqent/adapter-hermes/pure`: `hermesPure: PureAdapter`, plus `MissingCredentialError` (moved from `index.ts`), `UndeclaredCredentialError`, `EnvKeyConflictError`, `DuplicateSkillError`, `HermesConfigError`, `skillTarget(root: string, path: string): string` (now `joinPath(root, 'skills/' + confineRelative(…))`; same results as today, the `adapter.test.ts` test "rejects a skill path that escapes skills/" unchanged). `index.ts` re-exports the same names it exports today.

- [ ] **Step 1: Write the failing pure test**

`packages/adapter-hermes/test/translate.test.ts` builds `ReadFiles` in memory (no disk) and asserts:

```ts
const ctx = { root: '/h', home: '/home/u', cwd: '/home/u' };
const enc = new TextEncoder();
const read = new Map([
  ['/h/config.yaml', enc.encode('# keep me\nmodel: x\n')],
  ['/h/.env', enc.encode('EXISTING=1\n')],
]);

it('asks for the five HERMES_HOME files plus every bundle skill target, nothing else', () => {
  expect(hermesPure.inputs(bundle, new Map(), ctx).files.map((f) => f.path)).toEqual([
    'SOUL.md',
    'memories/MEMORY.md',
    'memories/USER.md',
    'config.yaml',
    '.env',
    ...bundle.list().filter((p) => p.startsWith('skills/')),
  ]);
});
it('reports replacing an existing, different skill file', () => {
  const skill = bundle.list().find((p) => p.startsWith('skills/'))!;
  const withSkill = new Map([...read, [`/h/${skill}`, enc.encode('my own skill\n')]]);
  expect(hermesPure.plan(bundle, withSkill, ctx).lossiness).toContainEqual({
    component: `skill ${skill}`,
    action: 'transformed',
    issue: 'replaces an existing, different skill file.',
  });
});
it('writes .env owner-only with the resolved value and keeps other lines', () => {
  const t = hermesPure.translate(bundle, read, resolved, ctx);
  const env = t.writes.find((w) => w.path === '.env');
  expect(env?.mode).toBe(0o600);
  expect(new TextDecoder().decode(env?.bytes)).toMatch(/^EXISTING=1\n/);
  expect(t.writes.filter((w) => w.path !== '.env').every((w) => w.mode === null)).toBe(true);
});
it('refuses to translate without every required credential', () => {
  expect(() => hermesPure.translate(bundle, read, {}, ctx)).toThrow(MissingCredentialError);
});
it('captures nested skills, stopping at the first SKILL.md', () => {
  const files = new Map([
    ['/h/skills/a/SKILL.md', enc.encode('---\nname: a\n---\n')],
    ['/h/skills/a/inner/SKILL.md', enc.encode('ignored')],
    ['/h/skills/group/b/SKILL.md', enc.encode('---\nname: b\n---\n')],
  ]);
  expect(hermesPure.capture(files, ctx).skillNames().sort()).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @uniqent/adapter-hermes build; pnpm vitest run packages/adapter-hermes/test/translate.test.ts`
Expected: FAIL — `./pure` missing.

- [ ] **Step 3: Make `translate.ts` pure**

- Imports: `Bundle` from `@uniqent/core/pure`; contract + `confineRelative`, `joinPath`, `readText`, `sameBytes`, `OWNER_ONLY`, `requiredCredentialRefs`, `assertNoEnvReferences`, `assertMcpCredentialScope` from `@uniqent/adapter-sdk/pure`.
- The local `Translation` interface (plan/files/env) is renamed `Draft` (the sdk's `Translation` is the pure result type).
- `homeFrom(bundle, read, ctx): HermesHome` = `readText` of the five files, plus `skills` = `read.get(joinPath(ctx.root, path))` for every bundle `skills/…` path that was read (today's `readHome`).
- `inputs(bundle, _read, ctx)` → the five `FileRef`s at `ctx.root`, then one `FileRef` per bundle `skills/…` path from `bundle.list()` (target via `confineRelative`, so a hostile path throws `PathEscapeError` before anything is read).
- `draft`: the skill overwrite check `!Buffer.from(prior).equals(Buffer.from(bytes))` becomes `!sameBytes(prior, bytes)`.
- `planInstall(bundle, read, ctx)` → `draft(bundle, homeFrom(bundle, read, ctx), ctx.root).plan`.
- `translate(bundle, read, resolved, ctx)`: missing-credential check (moved from `index.ts`), writes = draft files (`bytes` = `TextEncoder` of string content, raw bytes for skill files, `mode: null`) then, when `env.length > 0`, `.env` = `mergeEnv(home.env, …)` with `mode: OWNER_ONLY`; `notes` = the lossiness lines exactly as `apply()` builds them today, including the `transformed: .env — replaces your existing, different value of …` line when `mergeEnv` replaced a value.

- [ ] **Step 4: `capture.ts` and `pure.ts`**

`captureInputs(_read, ctx)` → files `SOUL.md`, `memories/MEMORY.md`, `memories/USER.md`, `config.yaml` + find `{ root: ctx.root, dir: 'skills', fileName: 'SKILL.md', skipDirs: ['venv', 'node_modules', 'site-packages', '__pycache__'] }`. `capture(read, ctx)` is `exportHermes` with reads replaced by `readText` and `Brain` from `@uniqent/builder/brain`; skill dirs = found keys under `skills/` ending in `/SKILL.md`, minus any whose ancestor dir also holds a `SKILL.md`, sorted (same order `findSkillDirs` produced); `DuplicateSkillError` names root-relative dirs as today.

`pure.ts`:

```ts
/** Browser-safe Hermes translation + capture (shared by the CLI and Studio). */
export const hermesPure: PureAdapter = {
  id: 'hermes',
  displayName: 'Hermes',
  inputs,
  plan: planInstall,
  translate,
  captureInputs,
  capture,
};
export {
  MissingCredentialError,
  UndeclaredCredentialError,
  EnvKeyConflictError,
  skillTarget,
} from './translate.js';
export { DuplicateSkillError } from './capture.js';
export { HermesConfigError } from './config.js';
export { MEMORY_MAX, USER_MAX, ENTRY_DELIMITER } from './memory.js';
```

`index.ts`: `export const hermesAdapter: Adapter = nodeAdapter(hermesPure, detect)` with today's `detect` body; `export * from './pure.js'`.

- [ ] **Step 5: Guards**

`package.json` `exports["./pure"]` → `dist/pure.{d.ts,js}`. ESLint pure globs add `'packages/adapter-hermes/src/{pure,translate,capture,config,env,mcp,memory,channels}.ts'`. `pure-entries.test.ts` adds `adapter-hermes/dist/pure.js`.

- [ ] **Step 6: Run tests and gates**

Run: `pnpm build && pnpm vitest run packages/adapter-hermes packages/cli apps/studio/test/install-fixtures.test.ts packages/builder/test/pure-entries.test.ts`, then the gates.
Expected: PASS — every pre-existing Hermes test unchanged, golden `hermes.json` still equal.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(adapter-hermes): pure translate/capture behind @uniqent/adapter-hermes/pure" -m "apply()/export() are now read → pure → write via nodeAdapter(); CLI output is byte-identical (golden trees unchanged)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Claude Code adapter split

**Files:**

- Create: `packages/adapter-claude-code/src/translate.ts` (from `index.ts`'s `skillTargets`, `replacedSkillFiles`, `readMcpJson`, `replacedServerIds`, `computeLossiness`, `computePlan`, `apply` body), `capture.ts` (from `export.ts`), `pure.ts`
- Modify: `index.ts` (Node wrapper + `detect`), `mcp.ts` (`resolvePlaceholders` from `@uniqent/core/pure`; `assertMcpCredentialScope` and the `ResolvedCredentials` type from `@uniqent/adapter-sdk/pure`), `agents-md.ts` (`stripMemoryMarkup` from `@uniqent/builder/memory`), `package.json`, `eslint.config.js`, `pure-entries.test.ts`
- Delete: `packages/adapter-claude-code/src/export.ts`
- Test: `packages/adapter-claude-code/test/translate.test.ts`; `adapter.test.ts` unchanged

**Interfaces:**

- Produces `@uniqent/adapter-claude-code/pure`: `claudeCodePure: PureAdapter` and the error classes/constants `index.ts` exports today (`McpConfigParseError`, `MissingCredentialError`, `CredentialScopeError` (re-exported from `@uniqent/adapter-sdk/pure`), `ManagedSectionError`, `MANAGED_BEGIN`, `MANAGED_END`, `toClaudeMcpEntry`).

- [ ] **Step 1: Write the failing pure test**

`translate.test.ts` (in-memory `ReadFiles`, `ctx = { root: '/p', … }`):

- `inputs` asks exactly `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, then `.claude/skills/<rest>` for every bundle `skills/<rest>` path (from `bundle.list()`).
- A different existing `.claude/skills/<name>/SKILL.md` in `read` is reported once as `{ component: 'skill .claude/skills/<name>/SKILL.md', action: 'transformed', issue: 'replaces an existing, different skill file.' }`; an identical one is not.
- With `CLAUDE.md` present, `translate` writes `CLAUDE.md` with the `@AGENTS.md` managed import and the note "CLAUDE.md exists, so Claude Code would ignore AGENTS.md; …".
- `.mcp.json` gets `mode: 0o600` and the do-not-commit note only when it inlines a credential; `mode: null` for a bundle whose servers need none.
- An unparseable `.mcp.json` throws `McpConfigParseError` naming `/p/.mcp.json`.
- `capture` keeps only `.claude/skills/<name>/SKILL.md` (depth 1), sorted by name; recovers a bearer credential requirement from `.mcp.json` without its value.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @uniqent/adapter-claude-code build; pnpm vitest run packages/adapter-claude-code/test/translate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Move the logic, unchanged except for I/O**

- Imports: `Bundle` from `@uniqent/core/pure`; contract + `confineRelative`, `joinPath`, `readText`, `sameBytes`, `OWNER_ONLY`, `requiredCredentialRefs`, `assertNoEnvReferences` from `@uniqent/adapter-sdk/pure`.
- `existsSync(resolveInside(root, X))` → `read.has(joinPath(ctx.root, X))`; `readIfExists` → `readText`.
- Skill targets: computed from `bundle.list()` (as today), `confineRelative('.claude/skills', rest)` → `FileRef { root: ctx.root, path: '.claude/skills/' + normalized }`. `inputs` computes them too, so the `adapter.test.ts` hardening test "rejects a skill path that escapes the skills dir, before writing anything" (whose hostile bundle overrides only `list`/`get`) throws `PathEscapeError` before anything is read or written.
- `replacedSkillFiles`: `existsSync` + `readFile` + `Buffer.equals` → `read.get(joinPath(ctx.root, target.path))` + `!sameBytes(prior, bytes)`.
- Error file names stay absolute: `joinPath(ctx.root, 'AGENTS.md')` etc. (same strings as `resolveInside` produced for an absolute root).
- Write order and notes exactly as `apply()` today: skills, `AGENTS.md`, `CLAUDE.md`, `.mcp.json`, then lossiness notes. `.mcp.json` `mode` = `inlinesSecrets ? OWNER_ONLY : null` (today: `{ mode: 0o666 }` on create, untouched mode otherwise; plus `chmod 0600` when inlining — `writeToDisk` reproduces both).
- `capture.ts`: `captureInputs` = the three files + find `{ dir: '.claude/skills', fileName: 'SKILL.md', skipDirs: [] }`; `capture` = `exportClaudeCode` over `readText` (`Brain` from `@uniqent/builder/brain`, `isLikelySecretValue` from `@uniqent/core/pure`), skill names from found keys matching `^\.claude/skills/([^/]+)/SKILL\.md$`, sorted.

Note: today's apply always ran `mkdir(root, { recursive: true })`; with the wrapper an install that writes nothing no longer creates an empty root. No test or golden depends on it.

- [ ] **Step 4: `pure.ts`, `index.ts`, guards**

Same shape as Task 3 (`claudeCodePure`, `nodeAdapter(claudeCodePure, detect)` with today's `detect`). ESLint globs add `'packages/adapter-claude-code/src/{pure,translate,capture,mcp,agents-md}.ts'`; `pure-entries.test.ts` adds `adapter-claude-code/dist/pure.js`.

- [ ] **Step 5: Run tests and gates**

Run: `pnpm build && pnpm vitest run packages/adapter-claude-code packages/adapter-hermes packages/cli apps/studio/test/install-fixtures.test.ts packages/builder/test/pure-entries.test.ts`, then the gates.
Expected: PASS (`claude-code.json` golden unchanged, including `captured`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(adapter-claude-code): pure translate/capture behind @uniqent/adapter-claude-code/pure" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: OpenClaw adapter split

**Files:**

- Create: `packages/adapter-openclaw/src/translate.ts` (from `index.ts` `draftInstall`, `envValues`, apply body), `capture.ts` (from `export.ts`), `pure.ts`
- Modify: `workspace.ts` (no `node:os`/`node:path`; `resolveWorkspace(ctx, configured)`), `index.ts` (Node wrapper + `detect`), `package.json`, `eslint.config.js`, `pure-entries.test.ts`
- Delete: `packages/adapter-openclaw/src/export.ts`; `fs.ts` keeps `isNotFound` (for `detect`)
- Test: `packages/adapter-openclaw/test/translate.test.ts`; `adapter.test.ts` unchanged

**Interfaces:**

- Produces `@uniqent/adapter-openclaw/pure`: `openClawPure: PureAdapter` + the error classes `index.ts` exports today (`ManagedSectionError`, `MANAGED_BEGIN`, `MANAGED_END`, `OpenClawConfigError`, `EnvValueEncodingError`, `InvalidEnvNameError`, `MissingCredentialError`, `EnvNameCollisionError`).
- `resolveWorkspace(ctx: TargetContext, configured: string | undefined): string` — `undefined` → `joinPath(ctx.root, 'workspace')`; `~` / `~/x` → `ctx.home`-based; anything else → `resolvePosix(ctx.cwd, trimmed)` (same rules as today with `homedir()`/`process.cwd()` injected).
- `workspaceRef(ctx, workspace, name): FileRef` — `{ root: ctx.root, path: '<ws-relative-to-root>/<name>' }` when the workspace lies under `ctx.root`, else `{ root: workspace, path: name }`; `name` always passes `confineRelative(workspace, name)`.

- [ ] **Step 1: Write the failing pure test**

`translate.test.ts`:

```ts
it('needs openclaw.json before it knows the workspace (two rounds)', async () => {
  const disk = new Map([
    [
      '/s/openclaw.json',
      enc.encode(JSON.stringify({ agents: { defaults: { workspace: '~/clawd' } } })),
    ],
  ]);
  const rounds: string[][] = [];
  const read = await gatherInputs(
    (r) => openClawPure.inputs(bundle, r, ctx),
    async (req) => {
      rounds.push(req.files.map((f) => `${f.root}|${f.path}`));
      return new Map(
        req.files.flatMap((f) => {
          const v = disk.get(joinPath(f.root, f.path));
          return v ? [[joinPath(f.root, f.path), v] as const] : [];
        }),
      );
    },
  );
  expect(rounds[1]).toContain('/home/u/clawd|SOUL.md');
  const t = openClawPure.translate(bundle, read, resolved, ctx);
  expect(t.writes.find((w) => w.path === 'SOUL.md')?.root).toBe('/home/u/clawd');
  expect(t.writes.find((w) => w.path === '.env')).toMatchObject({ root: '/s', mode: 0o600 });
});
```

Plus: the default workspace yields refs rooted at `ctx.root` with `workspace/` paths; a configured relative workspace resolves against `ctx.cwd`; a different existing skill file is reported as `transformed` (byte compare with `sameBytes`); an existing `.env` holding a different `GITHUB_PAT` makes `translate`'s notes contain `transformed: .env — replaces your existing, different value of GITHUB_PAT.` right before the `credentials stored in .env (mode 0600) as …` line; `capture` of a workspace `MEMORY.md` holding one fact and one episodic note returns both (`memoryFacts()` ids `m1…`, `memoryEpisodic()` ids `e1…`).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @uniqent/adapter-openclaw build; pnpm vitest run packages/adapter-openclaw/test/translate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Move the logic**

- `inputs(bundle, read, ctx)`: `openclaw.json` and `.env` at `ctx.root`, plus `SOUL.md`/`AGENTS.md`/`USER.md`/`MEMORY.md` and every bundle `skills/…` path under the workspace computed **from what has been read so far** (absent config → default workspace). `gatherInputs` re-asks after the first round and settles in round 3.
- Imports: `Bundle` from `@uniqent/core/pure`; contract + `confineRelative`, `joinPath`, `resolvePosix`, `displayPath`, `readText`, `sameBytes`, `OWNER_ONLY`, `requiredCredentialRefs`, `assertNoEnvReferences`, `assertMcpCredentialScope` from `@uniqent/adapter-sdk/pure`; `stripMemoryMarkup`, `parseMemoryMarkdown`, `parseProfile` from `@uniqent/builder/memory`; `Brain` from `@uniqent/builder/brain`.
- `draft` = `draftInstall` over `readText`/`read.get`; `Buffer.from(prior).equals(Buffer.from(bytes))` → `!sameBytes(prior, bytes)` (from `@uniqent/adapter-sdk/pure`).
- `FileWrite.display` disappears: plan writes use `displayPath(ctx.root, ref)` (identical strings to today's `displayPath(root, abs)`); `written` comes from `nodeAdapter`.
- `translate` writes workspace/config files with `mode: null`, then `.env` (`mergeEnvFile`) with `mode: OWNER_ONLY` when there are values; notes, in today's order = the lossiness lines, then `transformed: .env — replaces your existing, different value of <names>.` when `mergeEnvFile` replaced a value, then the `credentials stored in .env (mode 0600) as …` line.
- `capture.ts`: `captureInputs(read, ctx)` = `openclaw.json` + workspace `SOUL.md`, `IDENTITY.md`, `AGENTS.md`, `USER.md`, `MEMORY.md` + find `{ dir: <ws>/skills, fileName: 'SKILL.md', skipDirs: [] }` (fixpoint like install); `capture` = `exportOpenClaw` with depth-1 skills sorted by name (today: `names.sort()`). Episodic `MEMORY.md` items are **kept** (no more inline `continue`) with ids `e1, e2, …` from their own counter, so fact ids stay `m1…` exactly as today; `nodeAdapter.export` (Task 2) and Studio's capture (Task 10) drop and count them with `scrubPrivateMemory`, so `uniqent export` output is unchanged.

- [ ] **Step 4: `pure.ts`, `index.ts`, guards**

As in Tasks 3–4. ESLint globs add `'packages/adapter-openclaw/src/{pure,translate,capture,config,env,workspace}.ts'`; `pure-entries.test.ts` adds `adapter-openclaw/dist/pure.js`.

- [ ] **Step 5: Run tests and gates**

Run: `pnpm build && pnpm vitest run packages/adapter-openclaw packages/cli apps/studio/test/install-fixtures.test.ts packages/builder/test/pure-entries.test.ts`, then the gates.
Expected: PASS (`openclaw.json` golden unchanged, including `captured`; `writes into agents.defaults.workspace when configured` and the `.env` "different value" note test still pass).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(adapter-openclaw): pure translate/capture behind @uniqent/adapter-openclaw/pure" -m "inputs() is a two-round fixpoint (openclaw.json decides the workspace); workspace refs outside the state dir carry their own root. Capture keeps episodic items for the shared scrub to count. CLI output byte-identical." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Rust confined I/O (`read_inputs` / `write_outputs`) and framework homes

**Files:**

- Create: `apps/studio/src-tauri/src/fs_io.rs`
- Modify: `apps/studio/src-tauri/src/lib.rs` (`pub mod fs_io;`), `commands.rs`, `main.rs` (register)
- Test: `apps/studio/src-tauri/tests/fs_io_test.rs`

**Interfaces:**

- Produces (Rust, testable without Tauri):

```rust
pub const OWNER_ONLY: u32 = 0o600;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRequest { pub dir: String, pub file_name: String, pub skip_dirs: Vec<String> }

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadFile { pub path: String, pub bytes_base64: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputWrite { pub path: String, pub bytes_base64: String, pub mode: Option<u32> }

pub struct IoLimits { pub max_files: usize, pub max_file_bytes: u64, pub max_total_bytes: u64 }
/// 2000 files, 8 MiB per file, 64 MiB per call.
pub const DEFAULT_IO_LIMITS: IoLimits;

/// Root-relative POSIX path → normal components. Err for empty, absolute, `.`/`..`, `\`, NUL.
pub fn relative_components(path: &str) -> Result<Vec<String>, String>;
/// Read `files` (absent ones omitted) and every `finds` match; refuses any symlinked component.
pub fn read_inputs(root: &Path, files: &[String], finds: &[FindRequest], limits: &IoLimits) -> Result<Vec<ReadFile>, String>;
/// Validate every write first (path, base64, mode ∈ {None, Some(0o600)}, no duplicates), then
/// write each atomically: temp file in the same dir → fsync → rename. `Some(0o600)` creates the
/// temp 0600; `None` copies an existing target's permissions, else creates 0666 & ~umask.
/// Returns the written paths. Never follows or replaces through a symlinked parent.
pub fn write_outputs(root: &Path, writes: &[OutputWrite]) -> Result<Vec<String>, String>;

pub struct HomeEnv { pub home: PathBuf, pub hermes_home: Option<PathBuf>, pub openclaw_state_dir: Option<PathBuf> }
impl HomeEnv { pub fn from_process() -> Result<Self, String>; } // HOME required
/// ("hermes", $HERMES_HOME or ~/.hermes), ("openclaw", $OPENCLAW_STATE_DIR or ~/.openclaw) — cli/src/targets.ts defaultRoot rules.
pub fn framework_homes(env: &HomeEnv) -> Vec<(&'static str, PathBuf)>;
/// `root` must be absolute; canonicalized through its nearest existing ancestor (the rest must be
/// normal components). Allowed when it equals or lies under a granted folder or a framework home.
pub fn allowed_root(root: &str, granted: &[PathBuf], homes: &[PathBuf]) -> Result<PathBuf, String>;
```

- Produces (Tauri commands, args camelCase on the JS side; the two I/O commands are `async` like `read_vault`, so file work runs off the main thread):
  - `async read_inputs(root: String, files: Vec<String>, finds: Vec<FindRequest>) -> Result<Vec<ReadFile>, String>`
  - `async write_outputs(root: String, writes: Vec<OutputWrite>) -> Result<Vec<String>, String>`
  - `framework_homes() -> Result<Value /* { home, targets: [{ id, root, present }], claudeCodeUser: bool } */, String>` — hermes present = root is a dir; openclaw present = `root/openclaw.json` exists; `claudeCodeUser` = `~/.claude` exists
  - `folder_markers(dir: String, names: Vec<String>) -> Result<Vec<String>, String>` — only for a granted `dir`; each name must be a single normal component; returns the names that exist

- [ ] **Step 1: Write the failing Rust tests**

`apps/studio/src-tauri/tests/fs_io_test.rs` (all with `tempfile::tempdir()`; unix-only imports, helpers and tests behind `#[cfg(unix)]` so the file compiles on every platform):

```rust
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use base64::Engine;
use uniqent_studio::fs_io::*;

fn b64(s: &[u8]) -> String { base64::engine::general_purpose::STANDARD.encode(s) }
fn w(path: &str, body: &str, mode: Option<u32>) -> OutputWrite {
    OutputWrite { path: path.into(), bytes_base64: b64(body.as_bytes()), mode }
}
#[cfg(unix)]
fn mode_of(p: &std::path::Path) -> u32 { fs::metadata(p).unwrap().permissions().mode() & 0o777 }

#[test]
fn rejects_paths_that_leave_the_root() {
    let d = tempfile::tempdir().unwrap();
    for bad in ["/etc/passwd", "../x", "a/../../x", "a\\b", "", "./a", "a//b"] {
        let err = write_outputs(d.path(), &[w(bad, "x", None)]).unwrap_err();
        assert!(err.contains(bad) || bad.is_empty(), "{err}");
    }
}

#[cfg(unix)]
#[test]
fn never_writes_through_a_symlink() {
    let outside = tempfile::tempdir().unwrap();
    let d = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), d.path().join("memories")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("t.md"), d.path().join("AGENTS.md")).unwrap();
    assert!(write_outputs(d.path(), &[w("memories/MEMORY.md", "x", None)]).unwrap_err().contains("symlink"));
    assert!(write_outputs(d.path(), &[w("AGENTS.md", "x", None)]).unwrap_err().contains("symlink"));
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn secret_files_end_up_owner_only_and_others_keep_their_mode() {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join(".env"), "OLD=1\n").unwrap();
    fs::set_permissions(d.path().join(".env"), fs::Permissions::from_mode(0o644)).unwrap();
    fs::write(d.path().join("SOUL.md"), "old").unwrap();
    fs::set_permissions(d.path().join("SOUL.md"), fs::Permissions::from_mode(0o640)).unwrap();
    write_outputs(d.path(), &[w(".env", "K=v\n", Some(OWNER_ONLY)), w("SOUL.md", "new", None)]).unwrap();
    assert_eq!(mode_of(&d.path().join(".env")), 0o600);
    assert_eq!(mode_of(&d.path().join("SOUL.md")), 0o640);
    write_outputs(d.path(), &[w("skills/x/SKILL.md", "s", None)]).unwrap();
    assert_eq!(mode_of(&d.path().join("skills/x/SKILL.md")) & 0o600, 0o600);
    assert_ne!(mode_of(&d.path().join("skills/x/SKILL.md")), 0o600, "new non-secret files are not owner-only");
}

#[test]
fn validates_everything_before_writing_anything() {
    let d = tempfile::tempdir().unwrap();
    let err = write_outputs(d.path(), &[w("ok.md", "x", None), w("../bad", "x", None)]).unwrap_err();
    assert!(err.contains("../bad"), "{err}");
    assert!(!d.path().join("ok.md").exists());
    assert!(write_outputs(d.path(), &[w("a.md", "x", Some(0o644))]).unwrap_err().contains("mode"));
}

#[test]
fn rewriting_is_idempotent_and_leaves_no_temp_files() {
    let d = tempfile::tempdir().unwrap();
    let writes = [w("a/b.md", "same", None)];
    write_outputs(d.path(), &writes).unwrap();
    write_outputs(d.path(), &writes).unwrap();
    assert_eq!(fs::read_to_string(d.path().join("a/b.md")).unwrap(), "same");
    let names: Vec<_> = fs::read_dir(d.path().join("a")).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names.len(), 1, "{names:?}");
}

#[test]
fn errors_never_contain_file_content() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir(d.path().join(".env")).unwrap(); // a dir where a file must go
    let err = write_outputs(d.path(), &[w(".env", "SECRET_VALUE_123", Some(OWNER_ONLY))]).unwrap_err();
    assert!(!err.contains("SECRET_VALUE_123") && !err.contains(&b64(b"SECRET_VALUE_123")), "{err}");
}

#[cfg(unix)]
#[test]
fn reads_omit_absent_files_and_finds_skip_dot_skip_and_symlinked_dirs() {
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(outside.path().join("evil")).unwrap();
    fs::write(outside.path().join("evil/SKILL.md"), "x").unwrap();
    let d = tempfile::tempdir().unwrap();
    for p in ["skills/a", "skills/.git/h", "skills/venv/v", "skills/g/b"] {
        fs::create_dir_all(d.path().join(p)).unwrap();
        fs::write(d.path().join(p).join("SKILL.md"), p).unwrap();
    }
    std::os::unix::fs::symlink(outside.path(), d.path().join("skills/link")).unwrap();
    fs::write(d.path().join("SOUL.md"), "soul").unwrap();
    let got = read_inputs(
        d.path(),
        &["SOUL.md".into(), "missing.md".into()],
        &[FindRequest { dir: "skills".into(), file_name: "SKILL.md".into(), skip_dirs: vec!["venv".into()] }],
        &DEFAULT_IO_LIMITS,
    ).unwrap();
    let mut paths: Vec<_> = got.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    assert_eq!(paths, vec!["SOUL.md", "skills/a/SKILL.md", "skills/g/b/SKILL.md"]);
}

#[test]
fn only_granted_folders_and_framework_homes_are_allowed_roots() {
    let home = tempfile::tempdir().unwrap();
    let picked = tempfile::tempdir().unwrap();
    let env = HomeEnv { home: home.path().into(), hermes_home: None, openclaw_state_dir: None };
    let homes: Vec<_> = framework_homes(&env).into_iter().map(|(_, p)| p).collect();
    let granted = vec![picked.path().canonicalize().unwrap()];
    // A framework home that does not exist yet is allowed (first install creates it).
    assert!(allowed_root(home.path().join(".hermes").to_str().unwrap(), &granted, &homes).is_ok());
    assert!(allowed_root(home.path().join(".openclaw/workspace").to_str().unwrap(), &granted, &homes).is_ok());
    assert!(allowed_root(picked.path().join("proj").to_str().unwrap(), &granted, &homes).is_ok());
    for bad in [home.path().join(".ssh"), home.path().to_path_buf()] {
        let err = allowed_root(bad.to_str().unwrap(), &granted, &homes).unwrap_err();
        assert!(err.contains("Choose folder"), "{err}");
    }
    assert!(allowed_root("relative/dir", &granted, &homes).is_err());
    assert!(allowed_root(&format!("{}/.hermes/../.ssh", home.path().display()), &granted, &homes).is_err());
}

#[test]
fn read_limits_fail_loudly() {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join("big.md"), "x".repeat(2048)).unwrap();
    let limits = IoLimits { max_files: 10, max_file_bytes: 1024, max_total_bytes: 1 << 20 };
    assert!(read_inputs(d.path(), &["big.md".into()], &[], &limits).unwrap_err().contains("big.md"));
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/studio/src-tauri && cargo test --test fs_io_test`
Expected: compile error — `uniqent_studio::fs_io` missing.

- [ ] **Step 3: Implement `fs_io.rs`**

Module doc: "Confined file I/O for install and capture. Paths are relative to an allowed root, never absolute or `..`, never through a symlink. Writes are atomic and owner-only (0600) when they hold secrets. File content never appears in an error."

Key pieces:

```rust
/// The path to `root/components…` after checking no existing component is a symlink.
fn checked(root: &Path, components: &[String]) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    for c in components {
        p.push(c);
        match std::fs::symlink_metadata(&p) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(format!("refusing {}: it is a symlink", p.display()))
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("cannot stat {}: {e}", p.display())),
        }
    }
    Ok(p)
}

fn write_one(root: &Path, comps: &[String], bytes: &[u8], mode: Option<u32>) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let target = checked(root, comps)?;
    let parent = target.parent().expect("target has a parent");
    std::fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    checked(root, comps)?; // re-check after creating parents
    if target.is_dir() {
        return Err(format!("cannot write {}: a directory is in the way", target.display()));
    }
    let existing = std::fs::metadata(&target).ok().map(|m| m.permissions());
    let mut suffix = [0u8; 6];
    getrandom::fill(&mut suffix).map_err(|e| format!("OS random source unavailable: {e}"))?;
    let tmp = parent.join(format!(".{}.uniqent-{}", comps.last().unwrap(), hex::encode(suffix)));
    let create_mode = if mode == Some(OWNER_ONLY) { OWNER_ONLY } else { 0o666 };
    let result = (|| {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).mode(create_mode).open(&tmp)
            .map_err(|e| format!("cannot create a temp file in {}: {e}", parent.display()))?;
        f.write_all(bytes).and_then(|_| f.sync_all())
            .map_err(|e| format!("cannot write {}: {e}", target.display()))?;
        let set_mode = if mode == Some(OWNER_ONLY) {
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(OWNER_ONLY))
        } else if let Some(p) = existing {
            std::fs::set_permissions(&tmp, p)
        } else {
            Ok(())
        };
        set_mode.map_err(|e| format!("cannot set the mode of {}: {e}", target.display()))?;
        std::fs::rename(&tmp, &target).map_err(|e| format!("cannot replace {}: {e}", target.display()))
    })();
    if result.is_err() { let _ = std::fs::remove_file(&tmp); }
    result
}
```

(The `let _ =` on cleanup is the only ignored error: the original error is what's returned.) Gate `OpenOptionsExt`/`PermissionsExt` with `#[cfg(unix)]`; on other platforms return `Err("install is supported on macOS/Linux only for now")` from `write_outputs` so Windows still compiles.

`read_inputs` reads each file through `checked`, `NotFound` → omitted, enforces `IoLimits` (error names the path and the limit), walks finds with `symlink_metadata` (dirs only, skipping `.`-prefixed names and `skip_dirs`), encodes with `base64::engine::general_purpose::STANDARD`.

`allowed_root`: reject non-absolute and any `..`/`.` component; canonicalize the longest existing ancestor, append the remaining normal components; canonicalize each granted folder/home the same way; allowed when `candidate.starts_with(allowed)`; otherwise `Err(format!("{} is outside the folders Studio may use; pick it with \"Choose folder…\" first", root))`.

- [ ] **Step 4: Commands**

`commands.rs`:

```rust
fn allowed(s: &State<AppState>, root: &str) -> Result<PathBuf, String> {
    let env = crate::fs_io::HomeEnv::from_process()?;
    let homes: Vec<PathBuf> = crate::fs_io::framework_homes(&env).into_iter().map(|(_, p)| p).collect();
    crate::fs_io::allowed_root(root, &s.granted_dirs.lock().unwrap(), &homes)
}

/// Async so a large read/write runs off the main thread (same reason as `read_vault`).
#[tauri::command]
pub async fn read_inputs(s: State<'_, AppState>, root: String, files: Vec<String>, finds: Vec<crate::fs_io::FindRequest>)
    -> Result<Vec<crate::fs_io::ReadFile>, String> {
    let root = allowed(&s, &root)?;
    crate::fs_io::read_inputs(&root, &files, &finds, &crate::fs_io::DEFAULT_IO_LIMITS)
}

#[tauri::command]
pub async fn write_outputs(s: State<'_, AppState>, root: String, writes: Vec<crate::fs_io::OutputWrite>)
    -> Result<Vec<String>, String> {
    let root = allowed(&s, &root)?;
    crate::fs_io::write_outputs(&root, &writes)
}
```

plus `framework_homes` and `folder_markers` (uses `crate::vault::granted_dir` for the grant check, `relative_components` with exactly one component per name). Register all four in `main.rs`.

- [ ] **Step 5: Run the tests**

Run: `cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 6: Gates, commit**

```bash
git add -A
git commit -m "feat(studio-native): confined read_inputs/write_outputs and framework homes in Rust" -m "Roots must be a folder picked this session or a framework home (\$HERMES_HOME/~/.hermes, \$OPENCLAW_STATE_DIR/~/.openclaw); paths are relative, never .. or through a symlink; writes are validated up front, atomic (temp + rename), 0600 for secret files and mode-preserving otherwise; errors never echo content." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Byte-identical parity — Studio's path vs the CLI, for all three targets

**Files:**

- Modify: `apps/studio/scripts/emit-install-fixtures.ts` (adds `inputs` + `writes`), `apps/studio/fixtures/install/*.json` (regenerated: only the new keys may appear in the diff)
- Modify: `apps/studio/test/install-fixtures.test.ts`
- Create: `apps/studio/src-tauri/tests/install_parity_test.rs`

**Interfaces:**

- `InstallFixture` gains two keys, declared and emitted **between `tree` and `captured`** (JSON key order = insertion order), so the regenerated files only add lines:

```ts
  /** What the pure adapter asked to read (root-relative) and the bytes it got, on the seed. */
  inputs: {
    files: string[];
    finds: Array<{ dir: string; fileName: string; skipDirs: string[] }>;
    read: Record<string, string>; // path → base64
  };
  /** The pure translate's writes for the seed + credentials — exactly what Studio hands to write_outputs. */
  writes: Array<{ path: string; bytesBase64: string; mode: number | null }>;
```

- [ ] **Step 1: Write the failing Rust test**

`apps/studio/src-tauri/tests/install_parity_test.rs`:

```rust
//! Studio installs with the pure TS translate + Rust write_outputs; the CLI with the Node wrapper.
//! The TS side (apps/studio/test/install-fixtures.test.ts) proves `writes` is what the pure
//! translate produces and `tree` is what the CLI writes; this proves Rust read_inputs sees the
//! same bytes and write_outputs turns `writes` into exactly `tree` — so both paths are identical.
use base64::Engine;
use serde_json::Value;
use std::collections::BTreeMap;
use uniqent_studio::fs_io::*;

fn fixture(target: &str) -> Value {
    let p = format!("{}/../fixtures/install/{target}.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn snapshot(root: &std::path::Path) -> BTreeMap<String, (String, bool)> { /* walk files → (base64, mode & 0o077 == 0) */ }

#[cfg(unix)]
#[test]
fn studio_path_writes_the_cli_tree_for_every_target() {
    for target in ["claude-code", "hermes", "openclaw"] {
        let fx = fixture(target);
        let d = tempfile::tempdir().unwrap();
        for (path, text) in fx["seed"].as_object().unwrap() {
            let p = d.path().join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text.as_str().unwrap()).unwrap();
        }
        let files: Vec<String> = serde_json::from_value(fx["inputs"]["files"].clone()).unwrap();
        let finds: Vec<FindRequest> = serde_json::from_value(fx["inputs"]["finds"].clone()).unwrap();
        let read: BTreeMap<String, String> = read_inputs(d.path(), &files, &finds, &DEFAULT_IO_LIMITS)
            .unwrap().into_iter().map(|f| (f.path, f.bytes_base64)).collect();
        let want: BTreeMap<String, String> = serde_json::from_value(fx["inputs"]["read"].clone()).unwrap();
        assert_eq!(read, want, "{target}: read_inputs differs from what the TS translate consumed");

        let writes: Vec<OutputWrite> = serde_json::from_value(fx["writes"].clone()).unwrap();
        write_outputs(d.path(), &writes).unwrap();
        let tree: BTreeMap<String, (String, bool)> = fx["tree"].as_object().unwrap().iter()
            .map(|(k, v)| (k.clone(), (v["bytesBase64"].as_str().unwrap().into(), v["ownerOnly"].as_bool().unwrap())))
            .collect();
        assert_eq!(snapshot(d.path()), tree, "{target}: Studio tree differs from the CLI tree");
        write_outputs(d.path(), &writes).unwrap();
        assert_eq!(snapshot(d.path()), tree, "{target}: second write changed the tree");
    }
}
```

Run: `cd apps/studio/src-tauri && cargo test --test install_parity_test`
Expected: FAIL — fixtures have no `inputs`/`writes` keys.

- [ ] **Step 2: Emit `inputs` and `writes`**

In `buildInstallFixture`, on a **fresh** copy of the seed (before the CLI run): pick the pure adapter (`claudeCodePure`/`hermesPure`/`openClawPure`), `ctx = nodeContext(root)`, record every `readFromDisk` request while running `gatherInputs((r) => pure.inputs(bundle, r, ctx), recordingReader)`, then `pure.translate(bundle, read, credentials, ctx)`. Throw if any request or write has `root !== ctx.root` (the fixture is single-root by construction — the default OpenClaw workspace lies under the state dir). Store root-relative `files`, `finds` (`dir`, `fileName`, `skipDirs`), `read` (path → base64) and `writes` (`path`, base64, `mode`). Build the returned object as `{ target, seed, credentials, tree, inputs, writes, captured }` in that order: appending after `captured` would turn its closing `}` into `},`, and the Step 4 check would see a removed line.

- [ ] **Step 3: Extend the vitest guard**

The existing `toEqual(committed)` now also covers `inputs` and `writes`. Add one explicit assertion per target that applying `writes` with the Node `writeToDisk` onto a copy of the seed yields `tree` (so the TS side alone also proves translate ≡ CLI).

- [ ] **Step 4: Regenerate and review**

Run: `pnpm build && pnpm --filter @uniqent/studio fixtures:install && git --no-pager diff --stat apps/studio/fixtures/install`
Expected: only `inputs` and `writes` keys added (between `tree` and `captured`); `seed`, `credentials`, `tree`, `captured` unchanged (verify with `git --no-pager diff apps/studio/fixtures/install | grep '^-' | grep -v '^---'` → empty).

- [ ] **Step 5: Run both sides and the gates**

Run: `pnpm vitest run apps/studio/test/install-fixtures.test.ts && (cd apps/studio/src-tauri && cargo test --test install_parity_test)`, then the gates.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(studio): Studio's install path and the CLI write byte-identical trees" -m "Fixtures carry the pure translate's reads and writes; cargo test feeds them through Rust read_inputs/write_outputs and compares with the tree the real CLI wrote, for claude-code, hermes and openclaw, twice (idempotent)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Rust session — load, open, save a `.uniqent`; drag-and-drop grants

**Files:**

- Modify: `apps/studio/src-tauri/src/session.rs` (`policies` field passthrough; `load_bundle`; `bundle_files`)
- Modify: `apps/studio/src-tauri/src/commands.rs` (`AppState.granted_files`; new commands), `main.rs` (drag-drop handler, register)
- Test: `apps/studio/src-tauri/tests/load_bundle_test.rs`

**Interfaces:**

- Produces (Rust):
  - `Session::bundle_files(&self) -> Result<Vec<BundleFile>, String>` — the current draft as an **unsigned** bundle (`build_bundle`), `BundleFile { path: String, bytes_base64: String }` (camelCase).
  - `Session::load_bundle(bundle: &Bundle) -> Result<(Session, Vec<String>), String>` — builds a **new** session from a bundle (caller swaps it in only on success): meta (name/displayName/version/description, `compatibility.targets`), persona, policies, readme, avatar (data URL from `avatar.<ext>`), MCP servers, credentials, skills (`SKILL.md`), channels, tasks, non-episodic facts, profile. Each item validated with the same rules the session's setters use; errors name the bundle path and field. Returns `dropped`: human-readable lines for anything the session cannot hold (episodic items, `tools/tools.json`, `setup/runtime.json`, extra skill files, author/license/tags differing from the session's fixed values, the signature — "re-sign on export").
  - `pub fn open_bundle_bytes(bytes: &[u8]) -> Result<(Bundle, &'static str /* "valid" | "unsigned" */), String>` — `unpack` + `verify`; signed-but-invalid → `Err("signature is INVALID (<reason>): the bundle changed after signing; refusing to open")`.
- Produces (Tauri commands):
  - `bundle_files() -> Result<Vec<BundleFile>, String>`
  - `load_bundle_files(files: Vec<BundleFile>) -> Result<Value /* { state, dropped } */, String>` — used by capture; `Bundle::from_files` enforces path rules.
  - `async open_bundle() -> Result<Option<Value /* { state, dropped, signature } */>, String>` — native file dialog filtered to `.uniqent`. `async` like `pick_folder`: a `blocking_*` dialog on the main thread deadlocks.
  - `open_dropped_bundle(path: String) -> Result<Value, String>` — only a path in `granted_files` (recorded by the drop handler).
  - `async save_bundle() -> Result<Option<String>, String>` — native save dialog (default `<name>.uniqent`). It always signs with the session keypair: same pack/sign as `export(true)`, the only call Studio makes today, so there is no flag parameter. Atomic write via `fs_io` semantics; returns the path.
- Drag-and-drop (main.rs `.on_window_event`): on `tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. })`, canonicalize each path; directories → `granted_dirs`, regular files → `granted_files`; then `window.emit("studio://dropped", Vec<{ path, kind: "dir" | "file" }>)`. The webview never supplies a path Rust has not granted.

- [ ] **Step 1: Write the failing Rust tests**

`apps/studio/src-tauri/tests/load_bundle_test.rs`:

```rust
#[test]
fn opens_the_signed_golden_fixture_and_refuses_a_tampered_copy() {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/core/fixture-signed.uniqent");
    let bytes = std::fs::read(p).unwrap();
    let (bundle, sig) = open_bundle_bytes(&bytes).unwrap();
    assert_eq!(sig, "valid");
    let mut tampered = bundle.clone();
    tampered.set("identity/persona.md", b"changed".to_vec()).unwrap();
    let packed = uniqent_studio::core::archive::pack(&tampered).unwrap();
    assert!(open_bundle_bytes(&packed).unwrap_err().contains("INVALID"));
}

#[test]
fn capture_round_trip_loads_every_captured_component() {
    for target in ["claude-code", "hermes", "openclaw"] {
        let bundle = captured_bundle(target); // fixtures/install/<target>.json "captured" → Bundle::from_files
        let (s, dropped) = Session::load_bundle(&bundle).unwrap();
        let m = &s.state()["manifest"];
        assert_eq!(m["components"]["skills"], bundle_manifest(&bundle)["components"]["skills"], "{target}");
        assert_eq!(m["components"]["mcp"], bundle_manifest(&bundle)["components"]["mcp"], "{target}");
        assert_eq!(m["credentials"].as_array().unwrap().len(),
                   bundle_manifest(&bundle)["credentials"].as_array().unwrap().len(), "{target}");
        // Re-exported content equals the captured content for everything the session holds.
        let out: std::collections::BTreeMap<_, _> = s.bundle_files().unwrap().into_iter().map(|f| (f.path, f.bytes_base64)).collect();
        for path in ["identity/persona.md", "identity/policies.md", "memory/profile.json"] {
            if let Some(b) = bundle.get(path) { assert_eq!(out.get(path), Some(&b64(b)), "{target} {path}"); }
        }
        assert!(dropped.iter().all(|d| !d.contains("persona")), "{target}: {dropped:?}");
    }
}

#[test]
fn reports_what_the_session_cannot_hold() {
    // Bundle with episodic memory, tools and runtime (built via Bundle::from_files from JSON text).
    let (_, dropped) = Session::load_bundle(&rich_bundle()).unwrap();
    for needle in ["episodic", "tools", "runtime"] {
        assert!(dropped.iter().any(|d| d.contains(needle)), "{needle} not reported: {dropped:?}");
    }
}

#[test]
fn a_malformed_component_names_its_file_and_changes_nothing() {
    let err = Session::load_bundle(&bundle_with("mcp/servers.json", r#"{"servers":[{"id":"Bad Id"}]}"#)).unwrap_err();
    assert!(err.contains("mcp/servers.json"), "{err}");
}
```

Helpers (`captured_bundle`, `bundle_manifest`, `rich_bundle`, `bundle_with`, `b64`) live at the bottom of the test file.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/studio/src-tauri && cargo test --test load_bundle_test`
Expected: compile errors.

- [ ] **Step 3: Implement**

- `policies: Option<String>` on `Session` (default `None`; `build_bundle` writes `identity/policies.md` when set). `state()` is unchanged, so every `fixtures/state-*.json` golden still matches.
- `load_bundle` reuses the existing validators (`set_meta`, `add_custom_mcp`, `add_custom_skill`, `set_profile`, the fact checks in `import_memory`, `cron_problem` for schedule tasks); channels/tasks are checked field by field (`id` slug, `kind`/trigger shape) and stored verbatim; facts keep their `id`/`createdAt`/`tags`, and `fact_counter`/`task_counter` move past the highest numeric suffix.
- `open_bundle` / `save_bundle` are `pub async fn` (`app: tauri::AppHandle, s: State<'_, AppState>`, as `pick_folder`) and use `tauri_plugin_dialog::DialogExt` (`add_filter("Uniqent bundle", &["uniqent"])`, `blocking_pick_file()` / `set_file_name(..).blocking_save_file()`), read/write in Rust; the picked file is not added to any grant (it is consumed immediately). `save_bundle` signs exactly like `Session::export(true)` (reuse its keypair/sign/pack path, no copy).
- On success each command swaps the new session in: `*s.session.lock().unwrap() = new_session` (keeping `hub_index_urls` from the old one).

- [ ] **Step 4: Run tests, then the gates**

Run: `cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`, then the gates.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(studio-native): open, save and load .uniqent bundles; drag-and-drop grants" -m "Opening verifies the signature (tampered → refused, unsigned → loaded and flagged); saving always signs; load_bundle builds a fresh session and reports every component it cannot hold instead of dropping it silently; policies now pass through. Dropped files/folders are granted by Rust from the window event, never by a webview-supplied path." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Studio install flow (detect → plan → credentials → write)

**Files:**

- Create: `apps/studio/web/src/bytes.ts`, `apps/studio/web/src/install.ts`, `apps/studio/web/src/targets.ts`
- Modify: `apps/studio/web/src/api.ts` (`installPlan`/`install` native; new `installPreview`, `frameworkHomes`, `folderTargets`), `apps/studio/web/src/types.ts` (`FrameworkHomes` only — `InstallChoice` lives in `targets.ts`), `apps/studio/web/src/Inspector.tsx` (`InstallPanel`)
- Test: `apps/studio/web/src/install.test.ts`, `apps/studio/web/src/targets.test.ts`

**Interfaces:**

- Consumes: Tasks 2–6 (`@uniqent/adapter-*/pure`, `@uniqent/adapter-sdk/pure`, `@uniqent/core/pure`, `@uniqent/builder/brain` incl. `nextStep`), Rust `read_inputs`, `write_outputs`, `framework_homes`, `folder_markers`, `pick_folder`; Task 8 `bundle_files`.
- Produces:

```ts
// bytes.ts
export function toBase64(bytes: Uint8Array): string;
export function fromBase64(b64: string): Uint8Array;

// install.ts
export const PURE_ADAPTERS: Record<TargetId, PureAdapter>; // claudeCodePure, hermesPure, openClawPure
/** ReadFn over Rust read_inputs, one call per distinct root. */
export const readViaRust: ReadFn;
/** write_outputs per distinct root, in the translation's order. */
export function writeViaRust(writes: OutputWrite[]): Promise<void>;
/** The session draft failed validateBundle; message `brain is invalid; fix it before installing: <issues>` (as the old server). */
export class BrainInvalidError extends Error {
  constructor(readonly issues: string[]) {
    super(`brain is invalid; fix it before installing: ${issues.join('; ')}`);
    this.name = 'BrainInvalidError';
  }
}
/** The session draft as a Bundle; throws BrainInvalidError (listing the issues) before any read. */
export function sessionBundle(): Promise<Bundle>;
export function targetContext(root: string): Promise<TargetContext>; // home from framework_homes; cwd = home
/** Credential-free dry run (writes + lossiness + required credentials). */
export function planInstall(target: TargetId, root: string): Promise<InstallPlan>;
/**
 * Read + pure translate with the typed credentials, writing nothing: its `notes` include what only
 * the credentials reveal (e.g. "replaces your existing, different value of X" in .env), shown
 * before the user confirms.
 */
export function previewInstall(
  target: TargetId,
  root: string,
  resolved: ResolvedCredentials,
): Promise<Translation>;
/** Re-read, re-translate (validates before the first write) and hand the writes to Rust. */
export function applyInstall(
  target: TargetId,
  root: string,
  resolved: ResolvedCredentials,
): Promise<InstallResult>;

// targets.ts (pure)
export interface InstallChoice {
  id: TargetId;
  root: string | null;
  present: boolean;
}
/** One row per framework; preselect only when exactly one is present (ambiguity stays a choice). */
export function installChoices(homes: FrameworkHomes): {
  choices: InstallChoice[];
  preselected: TargetId | null;
};
/** A picked folder's project markers → the frameworks it holds (rules from @uniqent/builder/brain projectTargets). */
export function folderChoices(dir: string, present: string[]): InstallChoice[];
```

- [ ] **Step 1: Write the failing tests**

`install.test.ts` — a fake `invoke` backed by an in-memory disk (`Map<string, Uint8Array>`) implementing `bundle_files` (from a real `Brain` bundle built in the test), `framework_homes`, `read_inputs`, `write_outputs`; the real pure adapters run:

```ts
it('plans Hermes without writing, then writes .env owner-only with the typed credential', async () => {
  const plan = await planInstall('hermes', '/home/u/.hermes');
  expect(writeCalls).toHaveLength(0);
  expect(plan.requiresCredentials).toEqual(['github_pat', 'telegram_bot_token']);
  await applyInstall('hermes', '/home/u/.hermes', { github_pat: 'v1', telegram_bot_token: 'v2' });
  const env = lastWrites().find((w) => w.path === '.env');
  expect(env?.mode).toBe(0o600);
  expect(new TextDecoder().decode(fromBase64(env!.bytesBase64))).toContain('GITHUB_PAT=v1');
});

it('previews a replaced .env value before writing anything', async () => {
  disk.set('/home/u/.hermes/.env', enc('GITHUB_PAT=old\n'));
  const t = await previewInstall('hermes', '/home/u/.hermes', {
    github_pat: 'v1',
    telegram_bot_token: 'v2',
  });
  expect(writeCalls).toHaveLength(0);
  expect(t.notes).toContain(
    'transformed: .env — replaces your existing, different value of GITHUB_PAT.',
  );
});

it('never logs a credential value', async () => {
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
    vi.spyOn(console, k),
  );
  await applyInstall('openclaw', '/home/u/.openclaw', {
    github_pat: 'S3CRET',
    telegram_bot_token: 'T0KEN',
  });
  expect(writeCalls.length).toBeGreaterThan(0);
  for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toMatch(/S3CRET|T0KEN/);
});

it('refuses an invalid draft before reading anything', async () => {
  bundleFiles = invalidBrainFiles();
  await expect(planInstall('claude-code', '/p')).rejects.toThrow(BrainInvalidError);
  await expect(planInstall('claude-code', '/p')).rejects.toThrow(/brain is invalid/);
  expect(readCalls).toHaveLength(0);
});

it('writes an OpenClaw workspace outside the state dir with its own root', async () => {
  disk.set(
    '/home/u/.openclaw/openclaw.json',
    enc(JSON.stringify({ agents: { defaults: { workspace: '~/clawd' } } })),
  );
  await applyInstall('openclaw', '/home/u/.openclaw', creds);
  expect(writeCallRoots()).toEqual(['/home/u/clawd', '/home/u/.openclaw']);
});
```

`targets.test.ts`: one present → preselected; two present → `preselected: null`; a folder with `.claude` + `openclaw.json` → two choices rooted at the folder; Claude Code always has `root: null` until a folder is picked.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run apps/studio/web/src/install.test.ts apps/studio/web/src/targets.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `bytes.ts`, `install.ts`, `targets.ts`**

`bytes.ts` uses `atob`/`btoa` over 32 KiB chunks (no `Buffer`). `install.ts` follows the CLI's `runInstall` order: `sessionBundle()` (`validateBundle` from `@uniqent/core/pure`; throws `BrainInvalidError` as defined above) → `gatherInputs(…, readViaRust)` → `pure.plan` (`planInstall`) / `pure.translate` (`previewInstall`, no write; `applyInstall` = the same read + translate, then `writeViaRust`). `InstallResult.written` = `displayPath(ctx.root, w)`; `notes` = `t.notes`. No `console.*` anywhere in the module.

- [ ] **Step 4: Rework `InstallPanel`**

- On mount: `api.frameworkHomes()` → `installChoices` → radio list (`data-testid="install-target-<id>"`), each row showing its root and "found"/"not found". When `preselected` is null and more than one is present, show "Several agent frameworks found — choose one".
- "Choose folder…" (`data-testid="install-choose"`) → `api.chooseFolder()` → `api.folderTargets(dir)` → `folderChoices`; one match selects it, several become the choice list, none keeps the current target with `root = dir`.
- "Preview plan" (dry run, nothing written): writes with summaries, MCP registrations, and lossiness rendered as `action: component — issue` in full.
- Credential inputs (`type="password"`) for `requiresCredentials`; "Review changes" disabled until every required one is filled. It calls `previewInstall` (nothing written) and shows every write plus every `notes` line in full, including `.env` value replacements the credential-free plan cannot know. Only then does "Install into <target>" (`data-testid="install-confirm"`) call `applyInstall`. Values live only in component state and are cleared after install.
- A Rust "outside the folders Studio may use" error shows next to a "Choose folder…" button.
- Result: written paths, notes, and `nextStep(target, root)` from `@uniqent/builder/brain` (the same text the CLI prints).

- [ ] **Step 5: Run tests, build**

Run: `pnpm vitest run apps/studio && pnpm --filter @uniqent/studio typecheck && pnpm --filter @uniqent/studio build`
Expected: PASS.

- [ ] **Step 6: Gates, commit**

```bash
git add -A
git commit -m "feat(studio-native): install into Claude Code, Hermes and OpenClaw from the native app" -m "The web UI runs the adapters' pure translate on files Rust reads, previews writes + full lossiness + required credentials (and the credential-dependent notes before confirming), and hands the writes to Rust. Targets are auto-detected; several found frameworks are offered as a choice." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Capture, Open/Save, drag-and-drop in the web UI

**Files:**

- Create: `apps/studio/web/src/capture.ts`
- Modify: `apps/studio/web/src/api.ts` (`capture`, `openBundle`, `saveBundle`, `openDroppedBundle`), `apps/studio/web/src/App.tsx` (Open… and Save buttons; drop listener + chooser), `apps/studio/web/src/Inspector.tsx` (`CapturePanel`, selection `'capture'`), `apps/studio/web/src/types.ts`
- Test: `apps/studio/web/src/capture.test.ts`, `apps/studio/web/src/api.test.ts`

**Interfaces:**

```ts
// capture.ts
export interface CaptureResult {
  state: StudioState;
  removed: ScrubReport; // from @uniqent/builder/brain
  dropped: string[];
}
/** Read a framework setup via Rust, capture it with the shared pure adapter, scrub private memory, load it into the session. */
export function captureAgent(target: TargetId, root: string): Promise<CaptureResult>;

/** One entry of the Rust `studio://dropped` payload. */
export interface DroppedItem {
  path: string;
  kind: 'dir' | 'file';
}
export type DropAction =
  | { kind: 'open-bundle'; path: string }
  | { kind: 'choose-vault-or-capture'; dir: string }
  | { kind: 'unsupported' };
/** Pure routing for a drop: a single `.uniqent` file opens, a single folder offers vault/capture, anything else is unsupported. */
export function routeDrop(items: DroppedItem[]): DropAction;
```

- `api.openBundle(): Promise<{ state; dropped; signature: 'valid' | 'unsigned' } | null>`, `api.openDroppedBundle(path: string)`, `api.saveBundle(): Promise<string | null>` (always signed, see Task 8).

- [ ] **Step 1: Write the failing tests**

`capture.test.ts` (in-memory disk fake as in Task 9): an OpenClaw state dir whose workspace `MEMORY.md` holds a fact and an episodic note (Task 5's capture keeps it) → `load_bundle_files` receives files without `memory/episodic.jsonl` and with the fact, and `removed` is exactly `{ episodic: 1, personal: 0 }`; `dropped` passes through from Rust. A capture whose result fails `validateBundle` or `scanForSecrets` (both from `@uniqent/core/pure`) throws before `load_bundle_files` (same gate as `uniqent export`). `routeDrop`: `[{ path: '/x/a.uniqent', kind: 'file' }]` → `open-bundle`; `[{ path: '/x/vault', kind: 'dir' }]` → `choose-vault-or-capture`; a `.txt` file, two items or `[]` → `unsupported`. `api.test.ts`: `openBundle()` calls `open_bundle` with no args, `saveBundle()` calls `save_bundle` with no args, `openDroppedBundle('/x/a.uniqent')` calls `open_dropped_bundle` with `{ path: '/x/a.uniqent' }`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run apps/studio/web/src/capture.test.ts apps/studio/web/src/api.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `captureAgent`: `targetContext(root)` → `gatherInputs((r) => pure.captureInputs(r, ctx), readViaRust)` → `pure.capture` → `validateBundle` + `scanForSecrets` (fail loudly, naming the finding kind) → `scrubPrivateMemory` → `load_bundle_files` with base64 files. `routeDrop` lives in `capture.ts` too (pure, no React).
- `CapturePanel`: same target/root chooser as `InstallPanel` (reuse `installChoices`/`folderChoices` and the choice list component, extracted from `InstallPanel` in this step); a button labelled "Replace current brain with captured agent"; afterwards show component counts, "credentials to re-supply on install", "left out: N episodic, M personal memory items" and every `dropped` line.
- `App.tsx`: header "Open…" (`data-testid="open-btn"`) and Export now calls `api.saveBundle()` (native save dialog, always signed) instead of the blob-anchor download; `listen('studio://dropped', …)` from `@tauri-apps/api/event` passes the payload to `routeDrop` and only renders its result: `open-bundle` → `api.openDroppedBundle`; `choose-vault-or-capture` → a two-button chooser "Import as vault" (opens the vault panel with that dir) / "Capture agent" (opens `CapturePanel` with that root, markers via `folderTargets`); `unsupported` → "drop a .uniqent file or a folder".
- Show `signature: 'unsigned'` after Open as a visible warning.

- [ ] **Step 4: Run tests, build, gates**

Run: `pnpm vitest run apps/studio && pnpm --filter @uniqent/studio build`, then the gates.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(studio-native): capture an agent, open/save .uniqent, drag-and-drop" -m "Capture reads the framework via Rust, runs the shared pure capture, scrubs episodic and personal memory, and loads the brain onto the canvas with a report of everything left out. Open verifies the signature; Save uses the native dialog; dropping a .uniqent opens it and dropping a folder offers vault import or capture." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Delete the Node server

Every route of `apps/studio/src/server/api.ts` and what replaces it:

| Route(s)                                                                                                                         | Replacement                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/state`, `GET /api/catalog`, `POST /api/meta`, `/targets`, `/persona`, `/readme`, `/avatar`, `/avatar/remove`, `/reset` | Rust `state`, `catalog`, `set_meta`, `set_targets`, `set_persona`, `set_readme`, `set_avatar`, `remove_avatar`, `reset` (Phase 1) |
| `POST /api/mcp/catalog/:id`, `/mcp/custom`, `/mcp/import`, `/mcp/paste`, `/mcp/paste/add`, `/mcp/remove`                         | Rust `add_mcp_catalog`, `add_custom_mcp`, `import_mcp_servers`, `paste_mcp_preview`, `add_pasted_mcp`, `remove_mcp`               |
| `POST /api/skill/catalog/:name`, `/skill/custom`, `/skill/remove`, `/skill/url`                                                  | Rust `add_skill_catalog`, `add_custom_skill`, `remove_skill`; `native.importSkillFromUrl` (3b)                                    |
| `POST /api/channel/catalog/:id`, `/channel/remove`, `/task/add`, `/task/remove`                                                  | Rust `add_channel_catalog`, `remove_channel`, `add_task`, `remove_task`                                                           |
| `POST /api/memory`, `/memory/import`, `/memory/preview`, `GET /memory/graph`, `GET/POST /api/profile`                            | Rust `add_memory`, `import_memory`, `preview_memory`, `memory_graph`, `get_profile`, `set_profile`                                |
| `POST /api/memory/vault/preview`, `/vault/import`, `/memory/hub/search`, `/hub/add`, `/hub/publish`                              | `native.previewVault`, `importVaultDir`, `memoryHub`, `addMemoryPack`, `publishMemory` (3b)                                       |
| `GET/POST /api/hub/indexes`, `/hub/mcp/search`, `/hub/skills/search`, `/hub/mcp/add`, `/hub/skill/add`                           | `native.hubIndexes`, `setHubIndexes`, `hubMcp`, `hubSkills`, `addHubMcp`, `addHubSkill` (3b)                                      |
| `POST /api/export`                                                                                                               | Rust `export` / `save_bundle` (Task 8)                                                                                            |
| `POST /api/install/plan`, `/api/install`                                                                                         | `install.planInstall`, `install.applyInstall` (Task 9)                                                                            |
| static file serving, `guard.ts` (Host/Origin/JSON checks), `cron.ts`, `schemas.ts`                                               | gone: no HTTP surface remains; cron validation lives in Rust `cron_problem`, request validation in each Rust command              |

**Files:**

- Delete: `apps/studio/src/server/` (`api.ts`, `cron.ts`, `guard.ts`, `index.ts`, `schemas.ts`, `session.ts`), `apps/studio/tsconfig.json` (it only includes `src/server`)
- Delete tests that exercise only the server: `apps/studio/test/api.test.ts`, `session.test.ts`, `guard.test.ts`, `paste-mcp.test.ts`, `fixtures.test.ts`; script `apps/studio/scripts/emit-fixtures.ts`
- Create: `apps/studio/scripts/emit-catalog-fixtures.ts`, `apps/studio/test/catalog-fixtures.test.ts`
- Modify: `apps/studio/package.json` scripts (`build` → `pnpm build:web`; remove `build:server`, `start`, `dev:server`; `typecheck` → `tsc -p web/tsconfig.json --noEmit`; `fixtures` → `tsx scripts/emit-catalog-fixtures.ts && prettier --write fixtures/catalog.json fixtures/catalog-data.json`), drop `zod` if `grep -rn "from 'zod'" apps/studio/web/src` finds nothing
- Modify: `apps/studio/web/vite.config.ts` (remove the `/api` proxy), `apps/studio/web/src/api.ts` (invoke-only: delete `unwrap`/`get`/`post`, every `isNative ? … : post(…)` becomes the native call; `isNative` and the browser-mode vault text field in `Inspector.tsx` go), `apps/studio/web/src/api.test.ts` (drop browser-mode cases)
- Modify docs: `CLAUDE.md` (Studio run line at ~118 and the "local server is hardened…" sentence), `README.md` (lines ~146–153 and ~187–191), `examples/README.md` (the `pnpm --filter @uniqent/studio build && pnpm --filter @uniqent/studio start` line), `apps/studio/README.md` (fixtures line, native scope paragraph)
- Modify doc comments only: `apps/studio/src-tauri/src/session.rs` — `cron_problem`'s "Mirrors `cronProblem` in apps/studio/src/server/cron.ts" and the "`releaseCredentials` in apps/studio/src/server/session.ts" reference both point at deleted files; state the rule in place instead of naming the deleted source

**Interfaces:**

- `catalog.json` and `catalog-data.json` stay generated from `@uniqent/builder`'s `MCP_CATALOG`/`SKILL_CATALOG`/`CHANNEL_CATALOG` (Rust embeds both with `include_str!`). The `CatalogView` mapping moves verbatim from `StudioSession.catalog()` into `emit-catalog-fixtures.ts` (`targets: ['claude-code', 'hermes', 'openclaw']`). `fixtures/state-*.json` become frozen Rust goldens (no TS producer; `fixtures_test.rs` keeps asserting them).

- [ ] **Step 1: Write the failing guard tests**

`apps/studio/test/catalog-fixtures.test.ts` — `catalogView()` and `catalogData()` from the new script equal the committed JSONs. Add to `apps/studio/web/src/api.test.ts`:

```ts
it('has no HTTP fallback left', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  // `/api/` only as the start of a string literal: the `@tauri-apps/api/core` import must not match.
  expect(src).not.toMatch(/\bfetch\(|['"`]\/api\/|isNative/);
});
```

Run: `pnpm vitest run apps/studio`
Expected: FAIL (script missing; api.ts still has fetch).

- [ ] **Step 2: Check nothing else depends on the server**

Run: `grep -rn "src/server\|StudioSession\|4173\|studio start\|dev:server" --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=target --exclude-dir=superpowers . | grep -v "^./apps/studio/src/server"`
Expected: only the files listed above (tests/scripts being deleted, vite proxy, `README.md`/`examples/README.md`/`CLAUDE.md` lines, `apps/studio/package.json`, the two `session.rs` doc comments). The CLI and every package are independent of it.

- [ ] **Step 3: Delete, rewrite `api.ts`, add the catalog emitter**

Delete the files; rewrite `api.ts` as one `call()`-based object (move the 3b `call` helper from `native.ts` into `api.ts` or import it); add `emit-catalog-fixtures.ts`.

- [ ] **Step 4: Docs**

- `CLAUDE.md` Studio bullet: replace "Run: `pnpm --filter @uniqent/studio build && pnpm --filter @uniqent/studio start` (`:4173`, `UNIQENT_STUDIO_PORT` to override). Verified in a real browser. The native Tauri app … runs all of this except install/capture (Phase 4)" with "Run: `pnpm --filter @uniqent/studio native:dev` (dev) or `native:build` (Studio.app + DMG); there is no browser/server mode." and drop "the local server is hardened (127.0.0.1-only, …)" from the OpenClaw paragraph ("Studio's in-app **Install** button … drive them" stays).
- `README.md`: "Studio runs as a native desktop app (Tauri)…" — remove the `start` lines in both blocks and the "(web UI and local server)" note after `pnpm build`.
- `examples/README.md`: in "Or build your own in **Uniqent Studio** (…)", replace the command `pnpm --filter @uniqent/studio build && pnpm --filter @uniqent/studio start` with `pnpm --filter @uniqent/studio native:dev`.
- `session.rs` doc comments: "Mirrors `cronProblem` in apps/studio/src/server/cron.ts" → describe the accepted cron shape in place; drop the "`releaseCredentials` in apps/studio/src/server/session.ts" pointer the same way (comments only, no code change).
- `apps/studio/README.md`: fixtures line → "`pnpm --filter @uniqent/studio fixtures` — regenerate `catalog*.json` from the builder catalogs (Rust embeds them); `state-*.json` are frozen Rust goldens"; scope paragraph updated in Task 14.

- [ ] **Step 5: Run tests, gates**

Run: `pnpm build && pnpm vitest run apps/studio`, then the gates.
Expected: PASS; `pnpm --filter @uniqent/studio build` emits only `dist-web`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(studio)!: delete the Node server; Studio is native-only" -m "Every former /api route is a Rust command or shared pure TS over invoke(); no localhost port remains. Catalog fixtures are generated from the builder catalogs; state-*.json stay as frozen Rust goldens." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Strict CSP and minimal capabilities

**Files:**

- Modify: `apps/studio/src-tauri/tauri.conf.json` (`app.security`), `apps/studio/src-tauri/capabilities/default.json`
- Create: `apps/studio/src-tauri/tests/security_config_test.rs`

**Interfaces:**

- `app.security`:

```json
"security": {
  "csp": {
    "default-src": "'self'",
    "script-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob:",
    "font-src": "'self' data:",
    "connect-src": "ipc: http://ipc.localhost",
    "object-src": "'none'",
    "base-uri": "'none'",
    "form-action": "'none'",
    "frame-src": "'none'"
  },
  "devCsp": {
    "default-src": "'self'",
    "script-src": "'self' 'unsafe-inline'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob:",
    "font-src": "'self' data:",
    "connect-src": "ipc: http://ipc.localhost ws://localhost:5173 http://localhost:5173",
    "object-src": "'none'"
  },
  "dangerousDisableAssetCspModification": ["style-src"]
}
```

(`style-src 'unsafe-inline'` is required by xyflow/force-graph inline `style` attributes; Tauri would otherwise add a nonce to `style-src`, which makes browsers ignore `'unsafe-inline'`. Scripts stay nonce/hash-only. Network goes through the http plugin over IPC, so `connect-src` is IPC only.)

- `capabilities/default.json` permissions: `["core:event:allow-listen", "core:event:allow-unlisten", { "identifier": "http:default", "allow": [{ "url": "https://*" }, { "url": "https://*/*" }] }]` — `core:default` goes; dialogs are opened by Rust commands, so no `dialog:*` and no `fs:*`.

- [ ] **Step 1: Write the failing test**

`security_config_test.rs`:

```rust
#[test]
fn csp_is_strict_and_capabilities_are_minimal() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let conf: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("tauri.conf.json")).unwrap()).unwrap();
    let csp = &conf["app"]["security"]["csp"];
    assert!(csp.is_object(), "csp must not be null");
    let script = csp["script-src"].as_str().unwrap();
    assert!(!script.contains("unsafe-inline") && !script.contains("unsafe-eval"), "{script}");
    assert_eq!(csp["object-src"], "'none'");
    assert!(!csp["connect-src"].as_str().unwrap().contains("http://localhost"));

    let caps: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("capabilities/default.json")).unwrap()).unwrap();
    let ids: Vec<String> = caps["permissions"].as_array().unwrap().iter()
        .map(|p| p.as_str().map(String::from).unwrap_or_else(|| p["identifier"].as_str().unwrap().into()))
        .collect();
    assert_eq!(ids, ["core:event:allow-listen", "core:event:allow-unlisten", "http:default"]);
    assert!(ids.iter().all(|i| !i.starts_with("fs:") && !i.starts_with("shell:") && !i.starts_with("dialog:")));
}
```

Run: `cd apps/studio/src-tauri && cargo test --test security_config_test`
Expected: FAIL (`csp` is null).

- [ ] **Step 2: Apply the config, run tests**

Run: `cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 3: Native check (CSP is only enforced in the real webview)**

Run: `pnpm --filter @uniqent/studio native:build && open "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app"`
Check with Web Inspector (right-click → Inspect Element; enable `"devtools": true` temporarily only if needed — do not commit it): no CSP violations in the console while the canvas renders, the memory graph opens, an avatar image shows, a hub search runs and drag-drop fires. A violation must be fixed by naming the exact source in the CSP, never by `'unsafe-*'` in `script-src`.

- [ ] **Step 4: Gates, commit**

```bash
git add -A
git commit -m "feat(studio-native): strict CSP and minimal capabilities" -m "Scripts are self-only (no inline/eval), network only via the scoped http plugin over IPC; the webview gets event listen + https fetch and nothing else (no fs, shell or dialog permissions)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Release workflow — universal DMG on `studio-v*`

**Files:**

- Create: `.github/workflows/studio-release.yml`
- Modify: `apps/studio/package.json` (script `"native:build:universal": "tauri build --target universal-apple-darwin"`), `apps/studio/src-tauri/Cargo.toml` (`[profile.release]` adds `opt-level = "s"`, `panic = "abort"`)

**Interfaces:**

- Secrets (all optional): `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Tag `studio-vX.Y.Z` must equal `apps/studio/src-tauri/tauri.conf.json` `version` (the existing npm `release.yml` matches `v*`, which `studio-v*` does not trigger).

- [ ] **Step 1: Measure the size budget locally first**

Run:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm build && pnpm --filter @uniqent/studio native:build:universal
du -sk "apps/studio/src-tauri/target/universal-apple-darwin/release/bundle/macos/Uniqent Studio.app" apps/studio/src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg
```

Expected: record both numbers. Today's arm64-only `.app` is 13 MB (11 MB binary + 2.5 MB `icon.icns`); a universal binary roughly doubles the executable. The CI gate checks the **DMG** (what users download) against 15 MB and prints the `.app` size; if the DMG is over budget after `opt-level = "s"`/`panic = "abort"`, stop and report the numbers instead of raising the limit.

- [ ] **Step 2: Write the workflow**

```yaml
name: Studio release

# Build the native Studio as a universal macOS DMG and attach it to a GitHub Release.
# Tag with:  git tag studio-v0.1.0 && git push origin studio-v0.1.0  (must match tauri.conf.json "version")
# Signing, notarization and updater artifacts run only when their secrets exist.
on:
  push:
    tags: ['studio-v*']

concurrency:
  group: studio-release-${{ github.ref }}
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  macos:
    runs-on: macos-latest
    env:
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0'
      BUNDLE: apps/studio/src-tauri/target/universal-apple-darwin/release/bundle
      MAX_DMG_KB: '15360'
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Enable pnpm (corepack)
        run: |
          npm install -g corepack@latest
          corepack enable
          corepack prepare --activate

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin,x86_64-apple-darwin

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/studio/src-tauri

      - name: Tag matches the app version
        run: |
          want="studio-v$(node -p "require('./apps/studio/src-tauri/tauri.conf.json').version")"
          if [ "$GITHUB_REF_NAME" != "$want" ]; then
            echo "::error::tag $GITHUB_REF_NAME does not match tauri.conf.json version ($want)"
            exit 1
          fi

      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      - name: Build universal app + DMG
        env:
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          # Unset secrets arrive as empty strings; Tauri must not see them at all.
          if [ -z "$APPLE_CERTIFICATE" ]; then
            unset APPLE_CERTIFICATE APPLE_CERTIFICATE_PASSWORD APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
            echo "::warning::no APPLE_CERTIFICATE secret: building an unsigned DMG (users right-click → Open on first launch)"
          elif [ -z "$APPLE_ID" ]; then
            unset APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
            echo "::warning::signing without notarization (no APPLE_ID secret)"
          fi
          args=(--target universal-apple-darwin)
          if [ -n "$TAURI_SIGNING_PRIVATE_KEY" ]; then
            args+=(--config '{"bundle":{"createUpdaterArtifacts":true}}')
          else
            unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
          fi
          pnpm --filter @uniqent/studio exec tauri build "${args[@]}"

      - name: Size gate
        run: |
          app="$BUNDLE/macos/Uniqent Studio.app"
          dmg="$(ls "$BUNDLE"/dmg/*.dmg)"
          app_kb="$(du -sk "$app" | cut -f1)"
          dmg_kb="$(du -sk "$dmg" | cut -f1)"
          echo "Uniqent Studio.app: ${app_kb} KB, $(basename "$dmg"): ${dmg_kb} KB (budget ${MAX_DMG_KB} KB)"
          if [ "$dmg_kb" -gt "$MAX_DMG_KB" ]; then
            echo "::error::DMG is ${dmg_kb} KB, over the ${MAX_DMG_KB} KB budget"
            exit 1
          fi

      - name: Publish the GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          shopt -s nullglob
          assets=("$BUNDLE"/dmg/*.dmg "$BUNDLE"/macos/*.app.tar.gz "$BUNDLE"/macos/*.app.tar.gz.sig)
          gh release create "$GITHUB_REF_NAME" "${assets[@]}" \
            --title "Uniqent Studio ${GITHUB_REF_NAME#studio-v}" \
            --notes "Universal macOS build (Apple Silicon + Intel). If the app is unsigned, right-click it → Open on first launch."
```

- [ ] **Step 3: Validate**

Run: `actionlint .github/workflows/studio-release.yml` if installed (`brew install actionlint`), else re-read it against `ci.yml`'s step shapes. Then run Step 1's commands plus the size-gate shell block locally with `BUNDLE` and `MAX_DMG_KB` exported.
Expected: no lint errors; the local gate prints both sizes and exits 0.

- [ ] **Step 4: Gates, commit**

```bash
git add -A
git commit -m "ci(studio): universal macOS DMG release on studio-v* tags" -m "Codesign, notarization and updater artifacts run only when their secrets exist (unsigned DMG otherwise); the tag must match tauri.conf.json; the build fails when the DMG exceeds 15 MB." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Version bumps, docs, native smoke, human check

No version bumps: every package version on this stack is already ahead of npm and unpublished. npm has core/spec/adapter-sdk/adapters ≤ 0.1.2 and builder/cli ≤ 0.2.0; the stack has 0.2.0 and builder/cli 0.3.0. `release.yml`'s gate reports them as "new", so a second bump would be redundant. No `package.json` changes in this task.

**Files:**

- Modify: `CLAUDE.md` ("Current status"), `apps/studio/README.md` (scope paragraph), `docs/UX-REVIEW.md` only if it lists Studio install as missing

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Docs**

- `CLAUDE.md` "Current status": the Studio bullet says Studio is native-only: content, hubs, vault, publish **and** install-to-agent (all three targets, auto-detected, plan + full lossiness + credential prompts before Rust writes) and capture (scrubs episodic/personal by default), Open/Save `.uniqent`, drag-and-drop; the adapters' pure cores live at `@uniqent/adapter-*/pure` and are shared verbatim with the CLI; byte-identical install trees are pinned by `apps/studio/fixtures/install/*.json` (regenerate with `pnpm --filter @uniqent/studio fixtures:install`). Add to "Left for v1": signing/notarization/updater credentials (CI is wired, `studio-v*` tags). Mention the gotcha: Finder-launched apps do not inherit shell env vars, so `$HERMES_HOME`/`$OPENCLAW_STATE_DIR` set in a shell rc are not seen — Studio falls back to `~/.hermes`/`~/.openclaw` and "Choose folder…".
- `apps/studio/README.md`: replace the "Native scope (through Phase 3b)" paragraph with the Phase 4 scope in two sentences and add `native:build:universal`.

- [ ] **Step 2: Gates**

Run the gates. Expected: all green.

- [ ] **Step 3: Native launch smoke**

```bash
pnpm --filter @uniqent/studio native:build
du -sh "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app"
open "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app"; sleep 5
pgrep -f "Uniqent Studio.app/Contents/MacOS" >/dev/null && echo running
lsof -nP -iTCP -sTCP:LISTEN | grep -i uniqent || echo "no listening port"
osascript -e 'tell application "Uniqent Studio" to quit'
```

Expected: `running`, `no listening port`; report the app size.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(studio): Phase 4 — native install, capture and ship" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Human check (hand to the user)**

Ask the user to open Studio.app and: (1) build a brain with the github MCP + telegram channel, Install into Hermes (`~/.hermes` auto-detected) with test credentials, confirm `~/.hermes/.env` is 0600; (2) Install into a picked Claude Code project folder; (3) Install into OpenClaw; (4) compare one of those trees with `uniqent install` of the exported `.uniqent` into a scratch dir (`diff -r`); (5) Capture from Hermes and see the brain on the canvas with the "left out" report; (6) Save, then Open the saved file, and drag a `.uniqent` and a folder onto the window. Every step must work with no server running.

---

## Decisions

1. **Pure API shape refines the spec.** Reads/writes are `FileRef { root, path }` and `inputs(bundle, read, ctx)` is called to a fixpoint by `gatherInputs` — OpenClaw cannot know its workspace (possibly outside the state dir) before reading `openclaw.json`. `translate` takes the resolved credentials; a separate pure `plan` gives the credential-free preview. Rust keeps the spec's `read_inputs(root, …)`/`write_outputs(root, …)`; Studio calls them once per distinct root.
2. **Pure paths are POSIX** (`confineRelative`/`joinPath`/`resolvePosix`); the Node `resolveInside` stays for the conformance harness. The CLI is not tested on Windows today; the pure layer does not add Windows path support.
3. **Node writes stay non-atomic** (`writeFile` + `chmod`, as today) to keep the CLI byte- and mode-identical; Rust writes are atomic. Rust refuses symlinked components; the CLI keeps following them.
4. **Capture never follows symlinks and skips dot-dirs** for all three targets (CLI too). Install output is unchanged; capture differs only for symlinked or dot-named skill dirs in Claude Code/OpenClaw (Task 1's `captured` goldens confirm nothing else moves). Claude Code capture now sorts skills by name (previously `readdir` order).
5. **Capture always scrubs** episodic + `personal` memory with the shared `scrubPrivateMemory` (pure captures keep every item; OpenClaw no longer skips episodic inline). Studio reports the counts; `nodeAdapter.export` applies the same scrub, so `uniqent export` output is unchanged. No opt-in toggle (YAGNI, no flag).
6. **The Rust session gains only `policies`** (captured OpenClaw `AGENTS.md` would otherwise vanish). Tools, runtime, episodic memory, extra skill files and author/license/tags are reported in `dropped` on load, not modelled.
7. **Studio installs the session draft unsigned** after `validateBundle`, as the deleted server did; Open `.uniqent` verifies the signature (invalid → refused, unsigned → loaded with a warning).
8. **Allowed roots** = folders picked or dropped this session + `$HERMES_HOME`/`~/.hermes` + `$OPENCLAW_STATE_DIR`/`~/.openclaw` (env read from the app process). Claude Code always needs a picked project folder. Studio passes `cwd = home` (only affects a relative OpenClaw `agents.defaults.workspace`; the resolved path is shown in the plan, and writing there still needs a grant).
9. **Drag-and-drop is handled in Rust** (`WindowEvent::DragDrop`), which grants the dropped paths and emits `studio://dropped`; the webview never supplies a path to read.
10. **Export saves through the native save dialog** (`save_bundle()`), replacing the blob-anchor download; it always signs (Studio only ever exported signed), so there is no `sign` flag.
11. **State goldens are frozen** once the TS session is deleted; `catalog*.json` stay generated from the builder catalogs.
12. **Capabilities shrink to** `core:event:allow-listen/unlisten` + scoped `http:default`; CSP keeps `style-src 'unsafe-inline'` (inline style attributes) with `dangerousDisableAssetCspModification: ["style-src"]`.
13. **Size gate measures the DMG** (≤ 15 MB) and prints the `.app` size: a universal binary roughly doubles the 11 MB arm64 executable, so the umbrella spec's "app ≤ ~15 MB" (written for one architecture) cannot hold for a universal `.app`.
14. **Updater:** CI emits signed updater artifacts when `TAURI_SIGNING_PRIVATE_KEY` exists; the in-app updater plugin is not added (it needs a committed public key, i.e. the credentials that are out of scope).
