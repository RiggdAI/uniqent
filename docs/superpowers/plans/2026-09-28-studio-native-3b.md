# Studio Native — Hybrid Foundation + Phase 3b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Studio feature that still says "not yet available in the native app" (hub search/add, hub indexes, skill-from-URL, vault preview/import, memory hub search/add/publish) works in Studio.app, using one shared TypeScript implementation of the logic and Rust for all file access.

**Architecture:** Pure logic (hub sources + mappers, memory-hub client, vault parser, skill naming) becomes browser-safe behind subpath exports and takes the `fetch` function as an explicit argument. The CLI and the (still present) Node Studio server pass Node's `fetch`; the native web UI passes `@tauri-apps/plugin-http`'s `fetch`. Rust gains the session/file commands those features need; folders are chosen in Rust through the dialog plugin and only chosen folders can be read.

**Tech Stack:** TypeScript (ESM), Zod 4, Vitest 5, Tauri 2.12 + `tauri-plugin-http` + `tauri-plugin-dialog`, Rust.

**Spec:** `docs/superpowers/specs/2026-09-28-studio-native-ship-design.md` (sections "Decision: hybrid logic" and "Sub-project 2 — Hybrid foundation + Phase 3b")

## Global Constraints

- Rust owns all file I/O, HTTP permissioning, path confinement and the session; the webview never touches the filesystem directly (no general fs plugin).
- Pure modules (`@uniqent/core/pure`, `@uniqent/builder/hubs`, `@uniqent/builder/memory`) must not import `node:*` or use `Buffer`/`process` anywhere in their module graph.
- The existing `.` entry points of `@uniqent/core` and `@uniqent/builder` keep working unchanged for the CLI.
- No default parameter values; every function parameter explicit (user rule). Options objects may have optional fields.
- Errors are explicit and specific: HTTP failures carry status + body snippet; per-hub failures stay per-source (`errors[]`), never swallowed.
- External HTTP from the native app goes only through `@tauri-apps/plugin-http`, scoped to `https://` URLs.
- A folder can only be read by Rust after the user picked it with the native dialog in this session.
- Golden fixtures (`apps/studio/fixtures/**`) keep passing in both TS and Rust; regenerate ports fixtures with `pnpm --filter @uniqent/studio fixtures:ports` only when a ported behaviour intentionally changes.
- Commit at each task's final step; conventional commits ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Gates (**the gates**): `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && (cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings)`

## Review Focus

- A vault folder containing a symlink to `~/.ssh` (or any path outside the picked folder): the walk must not follow it — pinned by a Rust test in Task 4.
- A skill URL or JSON-index URL using `http://` or `file://` in the native app: must be refused with a clear message, not fetched — pinned by the capability scope + a web api test in Task 5.
- A corrupt `~/.uniqent/credentials.json`: publish must fail with an actionable error, not silently publish anonymously or crash — pinned by a Rust test in Task 3.
- Publishing a brain whose memory is all `personal`: must refuse ("no shareable memory to publish") and never send personal facts — pinned by a Rust test in Task 3.
- One hub hanging or 500-ing while others answer: results from the healthy hubs still show, the failing one appears in `errors` — pinned by the existing aggregate tests, re-run with injected fetch in Task 2.

---

### Task 1: Browser-safe entry points

**Files:**

- Create: `packages/core/src/pure.ts`
- Create: `packages/builder/src/hubs-entry.ts`, `packages/builder/src/memory-entry.ts`
- Modify: `packages/core/package.json` (`exports` adds `./pure`), `packages/builder/package.json` (`exports` adds `./hubs`, `./memory`)
- Modify: `packages/core/src/secret-scan.ts:208` (drop `Buffer`)
- Modify: `packages/builder/src/mcp/normalize.ts` (import from `@uniqent/core/pure`)
- Modify: `eslint.config.js` (no `node:*` / `Buffer` / `process` in pure files)
- Test: `packages/builder/test/pure-entries.test.ts`

**Interfaces:**

- Produces: `@uniqent/core/pure` exporting `Bundle`, `PATHS`, `BundleFormatError`, `BundleValidationError`, `validateBundle`, `scanForSecrets`, `isLikelySecretValue`, `findCredentialRefs`, `resolvePlaceholders`; `@uniqent/builder/hubs` exporting everything in `src/hubs/index.ts`; `@uniqent/builder/memory` exporting `memory/parse.ts` + `memory/vault.ts` (`importVault`, `memoryGraph`, `parseMemoryMarkdown`, `stripMemoryMarkup`, types).

- [ ] **Step 1: Write the failing import-graph test**

`packages/builder/test/pure-entries.test.ts` walks the built JS module graph from each pure entry and fails on Node-only imports or globals:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRIES = [
  resolve(root, 'core/dist/pure.js'),
  resolve(root, 'builder/dist/hubs-entry.js'),
  resolve(root, 'builder/dist/memory-entry.js'),
];
const RESOLVE: Record<string, string> = {
  '@uniqent/core/pure': resolve(root, 'core/dist/pure.js'),
  '@uniqent/spec': resolve(root, 'spec/dist/index.js'),
};

/** Every problem (node: import, Buffer, process, un-resolvable workspace import) reachable from `entry`. */
function problems(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    if (/\bBuffer\./.test(src)) found.push(`${file}: uses Buffer`);
    if (/\bprocess\./.test(src)) found.push(`${file}: uses process`);
    for (const m of src.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] as string;
      if (spec.startsWith('node:')) found.push(`${file}: imports ${spec}`);
      else if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else if (spec.startsWith('@uniqent/')) {
        const target = RESOLVE[spec];
        if (!target) found.push(`${file}: imports ${spec} (not a pure entry)`);
        else visit(target);
      }
    }
  };
  visit(entry);
  return found;
}

describe('browser-safe entry points', () => {
  for (const entry of ENTRIES) {
    it(`${entry.split('/packages/')[1]} has no Node-only code in its module graph`, () => {
      expect(existsSync(entry), `build first: ${entry}`).toBe(true);
      expect(problems(entry)).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm build && pnpm vitest run packages/builder/test/pure-entries.test.ts`
Expected: FAIL — `core/dist/pure.js` does not exist.

- [ ] **Step 3: Create the entries and remove Node-only code**

`packages/core/src/pure.ts`:

```ts
/**
 * Browser-safe subset of @uniqent/core (no node:*, Buffer or process in its module graph).
 * Used by the native Studio web UI; the CLI keeps using the full `.` entry.
 */
export { Bundle, PATHS } from './bundle.js';
export * from './errors.js';
export * from './secret-scan.js';
export * from './validate.js';
export * from './secret-refs.js';
```

`packages/core/package.json` `exports`:

```json
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./pure": { "types": "./dist/pure.d.ts", "default": "./dist/pure.js" }
```

`packages/core/src/secret-scan.ts:208` — replace `Buffer.from(bytes).toString('latin1')` with a module-level `const latin1 = new TextDecoder('latin1');` and `latin1.decode(bytes)` (same byte→char mapping).

`packages/builder/src/hubs-entry.ts`:

```ts
/** Browser-safe hub discovery (sources, mappers, memory hub). Pass the fetch function explicitly. */
export * from './hubs/index.js';
```

`packages/builder/src/memory-entry.ts`:

```ts
/** Browser-safe memory parsing: markdown → items, vault import, the memory graph. */
export * from './memory/parse.js';
export * from './memory/vault.js';
```

`packages/builder/package.json` `exports` adds `"./hubs"` → `dist/hubs-entry.{d.ts,js}` and `"./memory"` → `dist/memory-entry.{d.ts,js}` in the same shape as `.`.

`packages/builder/src/mcp/normalize.ts`: `import { isLikelySecretValue } from '@uniqent/core/pure';`

`packages/builder/src/hubs/github-skills.ts:96` uses `process.env.GITHUB_TOKEN` — Task 2 removes it (the token becomes an explicit option); leave it for now and expect the test to name it.

- [ ] **Step 4: Run the test**

Run: `pnpm build && pnpm vitest run packages/builder/test/pure-entries.test.ts`
Expected: core/pure and memory PASS; hubs FAILS only on `github-skills.js: uses process` (fixed in Task 2, whose Step 7 re-runs this test).

- [ ] **Step 5: Lint guard**

Add to `eslint.config.js`:

```js
  {
    // Browser-safe modules (bundled into the native Studio UI): no Node APIs.
    files: [
      'packages/core/src/{pure,bundle,errors,secret-scan,validate,secret-refs}.ts',
      'packages/builder/src/{hubs,memory}/**/*.ts',
      'packages/builder/src/{hubs-entry,memory-entry}.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*'], message: 'pure module: no Node APIs' }] }],
      'no-restricted-globals': ['error', 'Buffer', 'process'],
    },
  },
```

Run: `pnpm lint`
Expected: exactly one error — `process` in `github-skills.ts` (fixed in Task 2). Temporarily scope nothing out; Task 2 commits with lint green.

- [ ] **Step 6: Commit (with Task 2 — this task leaves lint red by design)**

Do not commit yet; Task 2 Step 8 commits both. Record in the ledger: `Task 1: done, committed with Task 2 (lint red on github-skills process until then)`.

---

### Task 2: Injected fetch for every hub call; skill naming moves into builder

**Files:**

- Modify: `packages/builder/src/hubs/http.ts`, `mcp-registry.ts`, `smithery.ts`, `github-skills.ts`, `json-index.ts`, `memory-hub.ts`, `bundle-hub.ts`, `defaults.ts`, `types.ts`
- Create: `packages/builder/src/hubs/skill-url.ts`
- Modify: `packages/cli/src/run.ts` (callers), `apps/studio/src/server/session.ts` (callers; skill helpers now imported)
- Test: `packages/builder/test/hubs.test.ts`, `packages/builder/test/bundle-hub.test.ts`, `packages/builder/test/skill-url.test.ts`, CLI tests that stub `globalThis.fetch`

**Interfaces:**

- Consumes: Task 1 entries.
- Produces (all exported from `@uniqent/builder/hubs`):
  - `type FetchFn = (input: string, init: RequestInit) => Promise<Response>;`
  - `hubFetch(fetchFn: FetchFn, source: string, url: string, headers: Record<string, string>, signal: AbortSignal | undefined): Promise<Response>`
  - `hubFetchJson(fetchFn: FetchFn, source: string, url: string, headers: Record<string, string>, signal: AbortSignal | undefined): Promise<unknown>`
  - `mcpRegistrySource(opts: { fetch: FetchFn; endpoint?: string })`, `smitherySource(opts: { fetch: FetchFn; endpoint?: string })`, `githubSkillsSource(opts: { fetch: FetchFn; token: string | undefined })`, `jsonIndexSource(opts: { fetch: FetchFn; url: string; label: string })`
  - `defaultMcpSources(opts: { fetch: FetchFn; jsonIndexUrls: string[] })`, `defaultSkillSources(opts: { fetch: FetchFn; jsonIndexUrls: string[]; githubToken: string | undefined })`
  - `searchMemoryHub(fetchFn: FetchFn, query: string, registry: string, signal: AbortSignal | undefined)`, `fetchMemoryPack(fetchFn: FetchFn, registry: string, slug: string, signal: AbortSignal | undefined)`, `publishMemoryPack(fetchFn: FetchFn, registry: string, token: string, pack: MemoryPackUpload, signal: AbortSignal | undefined)`, `publishBundle(fetchFn: FetchFn, …existing params)`
  - `skillNameFor(url: string, skillMd: string): string` and `fetchSkillMd(fetchFn: FetchFn, url: string, signal: AbortSignal | undefined): Promise<string>` in `skill-url.ts`
  - `DEFAULT_MEMORY_REGISTRY = 'https://uniqent.ai'`

- [ ] **Step 1: Write the failing tests**

In `packages/builder/test/hubs.test.ts`, replace every `globalThis.fetch = …` stub with a local fake passed explicitly, e.g.:

```ts
const fixtureFetch =
  (body: unknown, status: number): FetchFn =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

it('isolates a failing source and still returns the others', async () => {
  const ok = mcpRegistrySource({ fetch: fixtureFetch(registryFixture, 200) });
  const down = smitherySource({ fetch: fixtureFetch({ error: 'boom' }, 500) });
  const r = await searchMcpHubs('github', [ok, down]);
  expect(r.results.length).toBeGreaterThan(0);
  expect(r.errors.map((e) => e.source)).toContain('Smithery');
});
```

Keep every existing assertion; only the fetch wiring changes. Delete the `origFetch` save/restore block.

Create `packages/builder/test/skill-url.test.ts` (moved from the Studio server's private helpers, which today have no direct test):

```ts
import { describe, it, expect } from 'vitest';
import { skillNameFor, fetchSkillMd, type FetchFn } from '../src/hubs/index';

describe('skillNameFor', () => {
  it('prefers the SKILL.md frontmatter name', () => {
    expect(skillNameFor('https://example.com/x/SKILL.md', '---\nname: "triage"\n---\nbody')).toBe(
      'triage',
    );
  });
  it('falls back to the directory, never the git ref', () => {
    expect(
      skillNameFor('https://raw.githubusercontent.com/acme/tools/HEAD/review/SKILL.md', 'no fm'),
    ).toBe('review');
    expect(
      skillNameFor('https://raw.githubusercontent.com/acme/code-review/HEAD/SKILL.md', 'no fm'),
    ).toBe('code-review');
  });
  it('throws when nothing names the skill', () => {
    expect(() => skillNameFor('https://example.com/SKILL.md', 'no fm')).toThrow(
      /cannot name the skill/,
    );
  });
});

describe('fetchSkillMd', () => {
  it('rejects non-https URLs before fetching', async () => {
    let called = false;
    const f: FetchFn = async () => {
      called = true;
      return new Response('x');
    };
    await expect(fetchSkillMd(f, 'http://example.com/SKILL.md', undefined)).rejects.toThrow(
      /https/,
    );
    expect(called).toBe(false);
  });
  it('names the URL and status on a non-2xx', async () => {
    const f: FetchFn = async () => new Response('nope', { status: 404 });
    await expect(fetchSkillMd(f, 'https://example.com/SKILL.md', undefined)).rejects.toThrow(
      /404.*example\.com/,
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @uniqent/builder build; pnpm vitest run packages/builder/test/hubs.test.ts packages/builder/test/skill-url.test.ts`
Expected: FAIL (sources don't accept `fetch`; `skill-url` exports missing).

- [ ] **Step 3: Thread `fetchFn` through `http.ts`**

```ts
/** The fetch function a caller supplies: Node's global fetch, or Tauri's plugin-http fetch. */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export async function hubFetch(
  fetchFn: FetchFn,
  source: string,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  // …body unchanged except: const res = await fetchFn(url, { headers, signal: combined });
}

export async function hubFetchJson(
  fetchFn: FetchFn,
  source: string,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const res = await hubFetch(fetchFn, source, url, headers, signal);
  if (!res.ok) throw new HubHttpError(source, url, res.status, await bodySnippet(res), '');
  return res.json();
}
```

- [ ] **Step 4: Sources, defaults, memory hub, bundle hub take `fetch` explicitly**

Apply the Produces signatures. In each source factory keep the existing options (`endpoint`), add the required `fetch`, remove `= {}` defaults, and pass `opts.fetch` to `hubFetch`/`hubFetchJson`. `githubSkillsSource`: replace `opts.token ?? process.env.GITHUB_TOKEN` with `opts.token`. `jsonIndexSource(opts: { fetch; url; label })`. `defaults.ts`:

```ts
export interface McpHubOptions {
  fetch: FetchFn;
  /** Extra JSON-index hub URLs (e.g. a team's curated list). */
  jsonIndexUrls: string[];
}
export interface SkillHubOptions extends McpHubOptions {
  /** GitHub token raising the skill-search rate limit; undefined = unauthenticated (10 req/min). */
  githubToken: string | undefined;
}

export function defaultMcpSources(opts: McpHubOptions): CatalogSource[] {
  return [
    mcpRegistrySource({ fetch: opts.fetch }),
    smitherySource({ fetch: opts.fetch }),
    ...opts.jsonIndexUrls.map((url) =>
      jsonIndexSource({ fetch: opts.fetch, url, label: 'JSON index' }),
    ),
  ];
}

export function defaultSkillSources(opts: SkillHubOptions): CatalogSource[] {
  return [
    githubSkillsSource({ fetch: opts.fetch, token: opts.githubToken }),
    ...opts.jsonIndexUrls.map((url) =>
      jsonIndexSource({ fetch: opts.fetch, url, label: 'JSON index' }),
    ),
  ];
}
```

`memory-hub.ts`: add `fetchFn` as the first parameter to `searchMemoryHub`, `fetchMemoryPack`, `publishMemoryPack`; replace the raw `fetch(` in `publishMemoryPack` with `fetchFn(`; validate the search and pack responses with zod instead of casting:

```ts
const PackRow = z.object({
  slug: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  factCount: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
});
const SearchResponse = z.object({ packs: z.array(PackRow) });
```

(`searchMemoryHub` keeps its "never throws; errors[]" contract — a schema failure becomes an `errors` entry naming the registry URL.) In `publishMemoryPack`, replace `await res.json().catch(() => ({}))` (which hides an unparseable error body) with reading `res.text()`, parsing it only when `res.ok`, and throwing `Error(\`publish to ${url} failed: ${res.status} ${snippet}\`)`otherwise. Export`DEFAULT_MEMORY_REGISTRY = 'https://uniqent.ai'` from `memory-hub.ts`. `bundle-hub.ts`: `publishBundle(fetchFn, …)` using `fetchFn(`.

- [ ] **Step 5: Move skill naming into builder**

Create `packages/builder/src/hubs/skill-url.ts` with `frontmatterName`, `skillDirFromUrl`, `skillNameFor` moved verbatim from `apps/studio/src/server/session.ts:67-104`, plus:

```ts
/** Download a SKILL.md over https. Throws with the URL and status on any failure. */
export async function fetchSkillMd(
  fetchFn: FetchFn,
  url: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!url.startsWith('https://')) throw new Error(`skill URL must use https://, got ${url}`);
  const res = await hubFetch(fetchFn, 'skill', url, {}, signal);
  if (!res.ok) throw new HubHttpError('skill', url, res.status, await bodySnippet(res), '');
  return res.text();
}
```

Export it from `hubs/index.ts`. In `apps/studio/src/server/session.ts` delete the moved helpers and its private `fetchSkillMd`, import `skillNameFor`, `fetchSkillMd`, `DEFAULT_MEMORY_REGISTRY` from `@uniqent/builder`, and pass `fetch` everywhere:

```ts
searchHubMcp(query: string): Promise<HubSearch<McpHubResult>> {
  return searchMcpHubs(query, defaultMcpSources({ fetch, jsonIndexUrls: this.hubIndexUrls }));
}
```

(Same for `searchHubSkills` with `githubToken: process.env.GITHUB_TOKEN`, `searchMemoryHub(fetch, …, undefined)`, `fetchMemoryPack(fetch, …, undefined)`, `publishMemoryPack(fetch, …, undefined)`, `fetchSkillMd(fetch, url, undefined)`.)

- [ ] **Step 6: Update the CLI callers**

In `packages/cli/src/run.ts` pass `fetch` explicitly: `defaultMcpSources({ fetch, jsonIndexUrls: indexes })`, `defaultSkillSources({ fetch, jsonIndexUrls: indexes, githubToken: process.env.GITHUB_TOKEN })`, `publishMemoryPack(fetch, registry, token, pack, undefined)`, and `publishBundle(fetch, …)`. CLI tests that assign `globalThis.fetch` keep working (the CLI passes the global at call time).

- [ ] **Step 7: Run tests, entry test, lint**

Run: `pnpm build && pnpm vitest run packages/builder packages/cli apps/studio && pnpm lint`
Expected: PASS, including `pure-entries.test.ts` for all three entries and lint with zero errors.

- [ ] **Step 8: Run the gates, then commit Tasks 1+2**

```bash
git add -A
git commit -m "refactor(builder): browser-safe pure entries and injected fetch for hubs" -m "@uniqent/core/pure, @uniqent/builder/hubs and @uniqent/builder/memory have no Node APIs in their module graph (guarded by a test and ESLint). Every hub call takes the fetch function explicitly so the native app can pass Tauri's plugin-http fetch. Skill naming moved from the Studio server into builder; memory-hub responses are zod-validated." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rust session commands for hubs, memory provenance and publish

**Files:**

- Modify: `apps/studio/src-tauri/src/session.rs` (new methods; `import_memory` keeps `source`)
- Modify: `apps/studio/src-tauri/src/commands.rs`, `apps/studio/src-tauri/src/main.rs` (register)
- Create: `apps/studio/src-tauri/src/credentials.rs` (reads `~/.uniqent/credentials.json`)
- Modify: `apps/studio/src/server/session.ts` (`importItems` keeps `source` — TS parity)
- Test: `apps/studio/src-tauri/tests/hub_commands_test.rs`, `apps/studio/test/session.test.ts`

**Interfaces:**

- Produces (Tauri commands; args camelCase on the JS side):
  - `add_mcp_hub_result(server: Value, credentials: Vec<Value>) -> Result<Value /*state*/, String>`
  - `hub_indexes() -> Vec<String>`, `set_hub_indexes(urls: Vec<String>) -> Result<Vec<String>, String>`
  - `import_memory(payload)` — unchanged signature; each item may carry `source: string`
  - `publish_payload() -> Result<Value /*{slug,name,description,tags,facts:[{kind,text}]}*/, String>`
  - `registry_token(registry: String) -> Result<Option<String>, String>`

- [ ] **Step 1: Write the failing Rust tests**

`apps/studio/src-tauri/tests/hub_commands_test.rs`:

```rust
use serde_json::json;
use uniqent_studio::credentials::token_from_store;
use uniqent_studio::session::Session;

#[test]
fn hub_mcp_result_adds_server_and_every_credential() {
    let mut s = Session::new();
    s.add_mcp_hub_result(
        json!({"id":"linear","transport":"streamable-http","url":"https://mcp.linear.app/mcp",
               "auth":{"type":"bearer","credentialRef":"linear_token"},"tools":{"include":"all"}}),
        vec![json!({"ref":"linear_token","label":"Linear token","type":"bearer",
                    "consumedBy":["mcp:linear"],"required":true})],
    ).unwrap();
    let st = s.state();
    assert_eq!(st["manifest"]["components"]["mcp"], json!(["linear"]));
    assert_eq!(st["manifest"]["credentials"][0]["ref"], json!("linear_token"));
}

#[test]
fn hub_mcp_result_rejects_a_malformed_credential() {
    let mut s = Session::new();
    let err = s.add_mcp_hub_result(
        json!({"id":"x","transport":"stdio","command":"x","auth":{"type":"none"},"tools":{"include":"all"}}),
        vec![json!({"ref":"Not A Slug","type":"apiKey"})],
    ).unwrap_err();
    assert!(err.contains("credential"), "{err}");
    assert_eq!(s.state()["manifest"]["components"]["mcp"], json!([]));
}

#[test]
fn hub_indexes_keep_only_unique_https_urls() {
    let mut s = Session::new();
    let err = s.set_hub_indexes(vec!["http://insecure.example/index.json".into()]).unwrap_err();
    assert!(err.contains("https"), "{err}");
    let kept = s.set_hub_indexes(vec![" https://a.example/i.json ".into(), "https://a.example/i.json".into()]).unwrap();
    assert_eq!(kept, vec!["https://a.example/i.json".to_string()]);
}

#[test]
fn imported_memory_keeps_its_source() {
    let mut s = Session::new();
    s.import_memory(json!({"items":[{"text":"Met Alice","kind":"episodic","source":"journal/2026-01-01.md"}]})).unwrap();
    assert_eq!(s.memory_items()[0]["source"], json!("journal/2026-01-01.md"));
    let err = s.import_memory(json!({"items":[{"text":"x","source":42}]})).unwrap_err();
    assert!(err.contains("items[0].source"), "{err}");
}

#[test]
fn publish_payload_sends_only_shareable_facts() {
    let mut s = Session::new();
    s.import_memory(json!({"items":[{"text":"Team uses Postgres"},{"text":"My salary is X","visibility":"personal"}]})).unwrap();
    let p = s.publish_payload().unwrap();
    assert_eq!(p["facts"], json!([{"kind":"fact","text":"Team uses Postgres"}]));
    assert_eq!(p["slug"], s.state()["manifest"]["name"]);
}

#[test]
fn publish_payload_refuses_all_personal_memory() {
    let mut s = Session::new();
    s.import_memory(json!({"items":[{"text":"private","visibility":"personal"}]})).unwrap();
    assert!(s.publish_payload().unwrap_err().contains("no shareable memory"));
}

#[test]
fn registry_token_reads_the_cli_store_and_fails_loudly_on_corruption() {
    let store = r#"{"https://uniqent.ai":{"token":"tok123"}}"#;
    assert_eq!(token_from_store(store, "https://uniqent.ai/").unwrap(), Some("tok123".into()));
    assert_eq!(token_from_store(store, "https://other.example").unwrap(), None);
    let err = token_from_store("{not json", "https://uniqent.ai").unwrap_err();
    assert!(err.contains("credentials.json"), "{err}");
}
```

Add `pub fn memory_items(&self) -> Vec<Value>` to `Session` (a clone of the `facts` field) — the tests read provenance through it.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/studio/src-tauri && cargo test --test hub_commands_test`
Expected: compile errors for the missing methods/module.

- [ ] **Step 3: Implement the session methods**

In `session.rs`:

- `add_mcp_hub_result(&mut self, server: Value, credentials: Vec<Value>) -> Result<(), String>`: validate every credential first (object with `ref` matching the credential slug rule already used by validation, `type` one of `apiKey|bearer|header|oauth2|envVar|basic` per the spec enum, `label` string, `consumedBy` string array, `required` bool) — on any failure return `Err("credential[<i>] …")` and change nothing; then call the existing `add_custom_mcp(server)` and `add_credential` for each.
- `hub_indexes`/`set_hub_indexes`: new field `hub_index_urls: Vec<String>`; trim, reject any non-`https://` URL with `Err("hub index URLs must use https://, got <url>")`, dedupe preserving order.
- `import_memory`: when an item has `source`, it must be a string (else `Err("items[<i>].source must be a string")`) and is stored on the fact.
- `publish_payload(&self) -> Result<Value, String>`: manifest `name`→`slug`, `displayName`→`name`, `description`, `tags`; `facts` = non-personal facts as `{kind, text}`; empty → `Err("no shareable memory to publish")`.

Mirror `source` in `apps/studio/src/server/session.ts` `importItems` (`if (typeof raw.source === 'string') item.source = raw.source;`) so TS and Rust stay in parity.

- [ ] **Step 4: Implement the credential-store reader**

`apps/studio/src-tauri/src/credentials.rs`:

```rust
//! Reads publish tokens from the CLI's store (`$UNIQENT_CONFIG_DIR` or `~/.uniqent`)/credentials.json,
//! so `uniqent login` also signs Studio in. Shape: { "<registry base>": { "token": "…" } }.
use serde_json::Value;
use std::path::PathBuf;

fn store_path() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("UNIQENT_CONFIG_DIR") {
        return Ok(PathBuf::from(dir).join("credentials.json"));
    }
    let home = std::env::var("HOME").map_err(|_| "HOME is not set; cannot find ~/.uniqent/credentials.json".to_string())?;
    Ok(PathBuf::from(home).join(".uniqent").join("credentials.json"))
}

/// The token stored for `registry` in the given store JSON (trailing slashes ignored).
pub fn token_from_store(json: &str, registry: &str) -> Result<Option<String>, String> {
    let store: Value = serde_json::from_str(json)
        .map_err(|e| format!("credentials.json is not valid JSON ({e}); run `uniqent login` again"))?;
    let key = registry.trim_end_matches('/');
    Ok(store.get(key).and_then(|v| v.get("token")).and_then(Value::as_str).map(String::from))
}

/// The stored token for `registry`, or None when the user has not logged in.
pub fn registry_token(registry: &str) -> Result<Option<String>, String> {
    let path = store_path()?;
    match std::fs::read_to_string(&path) {
        Ok(json) => token_from_store(&json, registry),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}
```

Add `pub mod credentials;` to `lib.rs`.

- [ ] **Step 5: Expose and register the commands**

`commands.rs` (same style as existing commands):

```rust
#[tauri::command]
pub fn add_mcp_hub_result(s: State<AppState>, server: Value, credentials: Vec<Value>) -> Result<Value, String> {
    let mut g = s.0.lock().map_err(|e| e.to_string())?;
    g.add_mcp_hub_result(server, credentials)?;
    Ok(g.state())
}
#[tauri::command]
pub fn hub_indexes(s: State<AppState>) -> Result<Vec<String>, String> {
    Ok(s.0.lock().map_err(|e| e.to_string())?.hub_indexes())
}
#[tauri::command]
pub fn set_hub_indexes(s: State<AppState>, urls: Vec<String>) -> Result<Vec<String>, String> {
    s.0.lock().map_err(|e| e.to_string())?.set_hub_indexes(urls)
}
#[tauri::command]
pub fn publish_payload(s: State<AppState>) -> Result<Value, String> {
    s.0.lock().map_err(|e| e.to_string())?.publish_payload()
}
#[tauri::command]
pub fn registry_token(registry: String) -> Result<Option<String>, String> {
    crate::credentials::registry_token(&registry)
}
```

(Match how existing commands lock the mutex — copy their exact pattern if it differs.) Register all five in `main.rs`'s `generate_handler!`.

- [ ] **Step 6: Run the tests**

Run: `cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cd ../../.. && pnpm vitest run apps/studio`
Expected: PASS. If a parity fixture changes because `source` is now kept, regenerate with `pnpm --filter @uniqent/studio fixtures` and confirm both sides pass.

- [ ] **Step 7: Gates, commit**

```bash
git add -A
git commit -m "feat(studio-native): Rust commands for hub results, hub indexes, memory provenance and publish" -m "add_mcp_hub_result validates every credential before changing anything; hub index URLs must be https; imported memory keeps its source; publish_payload sends only shareable facts; registry_token reads the CLI's credentials store and fails loudly on a corrupt file." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Folder picking in Rust and a confined vault read

**Files:**

- Modify: `apps/studio/src-tauri/Cargo.toml`, `apps/studio/package.json` (via `pnpm tauri add dialog`)
- Create: `apps/studio/src-tauri/capabilities/default.json` (if `tauri add` does not create it)
- Create: `apps/studio/src-tauri/src/vault.rs`
- Modify: `apps/studio/src-tauri/src/commands.rs`, `src/main.rs`, `src/lib.rs`
- Test: `apps/studio/src-tauri/tests/vault_test.rs`

**Interfaces:**

- Produces:
  - `pick_folder() -> Result<Option<String>, String>` (Tauri command): opens the native folder dialog; the picked absolute path is recorded as granted in `AppState` and returned; `None` when cancelled.
  - `read_vault(dir: String) -> Result<Vec<{ path: String, content: String }>, String>`: only for a granted `dir`.
  - Rust (for tests): `vault::walk_vault(root: &Path, limits: &VaultLimits) -> Result<Vec<VaultFile>, String>`, `VaultLimits { max_files: usize, max_file_bytes: u64, max_total_bytes: u64 }`, `vault::DEFAULT_LIMITS` (5000 files, 1 MiB/file, 64 MiB total).

- [ ] **Step 1: Add the dialog plugin (vendor command)**

Run: `cd apps/studio && pnpm tauri add dialog`
Expected: `tauri-plugin-dialog` in `Cargo.toml`, `@tauri-apps/plugin-dialog` in `package.json`, `.plugin(tauri_plugin_dialog::init())` in `main.rs`, and `"dialog:default"` in `src-tauri/capabilities/default.json`. If the command cannot edit `main.rs` (custom layout), add the `.plugin(...)` line by hand.

- [ ] **Step 2: Write the failing vault tests**

`apps/studio/src-tauri/tests/vault_test.rs`:

```rust
use std::fs;
use uniqent_studio::vault::{walk_vault, VaultLimits, DEFAULT_LIMITS};

fn tmp() -> tempfile::TempDir { tempfile::tempdir().unwrap() }

#[test]
fn reads_markdown_with_posix_paths_and_skips_tooling_dirs() {
    let d = tmp();
    fs::create_dir_all(d.path().join("notes/sub")).unwrap();
    fs::create_dir_all(d.path().join(".obsidian")).unwrap();
    fs::write(d.path().join("SOUL.md"), "soul").unwrap();
    fs::write(d.path().join("notes/sub/a.md"), "a").unwrap();
    fs::write(d.path().join("notes/b.txt"), "not md").unwrap();
    fs::write(d.path().join(".obsidian/workspace.md"), "skip").unwrap();
    let mut paths: Vec<String> = walk_vault(d.path(), &DEFAULT_LIMITS).unwrap().into_iter().map(|f| f.path).collect();
    paths.sort();
    assert_eq!(paths, vec!["SOUL.md", "notes/sub/a.md"]);
}

#[cfg(unix)]
#[test]
fn never_follows_symlinks_out_of_the_vault() {
    let outside = tmp();
    fs::write(outside.path().join("secret.md"), "id_rsa").unwrap();
    let d = tmp();
    std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.md"), d.path().join("s.md")).unwrap();
    assert!(walk_vault(d.path(), &DEFAULT_LIMITS).unwrap().is_empty());
}

#[test]
fn fails_with_a_clear_error_past_the_limits() {
    let d = tmp();
    for i in 0..3 { fs::write(d.path().join(format!("{i}.md")), "x").unwrap(); }
    let err = walk_vault(d.path(), &VaultLimits { max_files: 2, max_file_bytes: 1024, max_total_bytes: 1024 }).unwrap_err();
    assert!(err.contains("more than 2"), "{err}");
    fs::write(d.path().join("big.md"), "x".repeat(2048)).unwrap();
    let err = walk_vault(d.path(), &VaultLimits { max_files: 100, max_file_bytes: 1024, max_total_bytes: 1_000_000 }).unwrap_err();
    assert!(err.contains("big.md"), "{err}");
}

#[test]
fn rejects_non_utf8_notes_by_name() {
    let d = tmp();
    fs::write(d.path().join("bad.md"), [0xff, 0xfe, 0xfd]).unwrap();
    let err = walk_vault(d.path(), &DEFAULT_LIMITS).unwrap_err();
    assert!(err.contains("bad.md") && err.contains("UTF-8"), "{err}");
}
```

Add `tempfile = "3"` under `[dev-dependencies]` in `Cargo.toml`.

- [ ] **Step 3: Run to verify they fail**

Run: `cd apps/studio/src-tauri && cargo test --test vault_test`
Expected: compile error — `uniqent_studio::vault` missing.

- [ ] **Step 4: Implement `vault.rs`**

```rust
//! Walk a user-picked vault folder for markdown notes. Never follows symlinks, skips
//! dot/tooling directories, and fails loudly past the size limits (no silent truncation).
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct VaultFile { pub path: String, pub content: String }

pub struct VaultLimits { pub max_files: usize, pub max_file_bytes: u64, pub max_total_bytes: u64 }
pub const DEFAULT_LIMITS: VaultLimits = VaultLimits { max_files: 5000, max_file_bytes: 1 << 20, max_total_bytes: 64 << 20 };

const SKIP: [&str; 4] = [".git", ".obsidian", "node_modules", ".trash"];

pub fn walk_vault(root: &Path, limits: &VaultLimits) -> Result<Vec<VaultFile>, String> {
    let mut out = Vec::new();
    let mut total: u64 = 0;
    walk(root, root, limits, &mut out, &mut total)?;
    Ok(out)
}

fn walk(root: &Path, dir: &Path, l: &VaultLimits, out: &mut Vec<VaultFile>, total: &mut u64) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || SKIP.contains(&name.as_str()) { continue; }
        // file_type() does not follow symlinks: a symlink is neither dir nor file here → skipped.
        let ft = entry.file_type().map_err(|e| format!("cannot stat {}: {e}", entry.path().display()))?;
        let path = entry.path();
        if ft.is_dir() {
            walk(root, &path, l, out, total)?;
        } else if ft.is_file() && name.to_lowercase().ends_with(".md") {
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?
                .components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
            if out.len() >= l.max_files {
                return Err(format!("vault has more than {} markdown notes; pick a smaller folder", l.max_files));
            }
            let size = entry.metadata().map_err(|e| format!("cannot stat {rel}: {e}"))?.len();
            if size > l.max_file_bytes {
                return Err(format!("{rel} is {size} bytes, over the {} byte per-note limit", l.max_file_bytes));
            }
            *total += size;
            if *total > l.max_total_bytes {
                return Err(format!("vault is over the {} byte total limit", l.max_total_bytes));
            }
            let bytes = std::fs::read(&path).map_err(|e| format!("cannot read {rel}: {e}"))?;
            let content = String::from_utf8(bytes).map_err(|_| format!("{rel} is not valid UTF-8 text"))?;
            out.push(VaultFile { path: rel, content });
        }
    }
    Ok(())
}
```

Add `pub mod vault;` to `lib.rs`.

- [ ] **Step 5: Grants + commands**

Add `pub granted_dirs: Mutex<Vec<std::path::PathBuf>>` to `AppState` (a second field; update `main.rs`'s `.manage(AppState(...))` construction accordingly). Commands:

```rust
#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle, s: State<'_, AppState>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
    let path = picked.into_path().map_err(|e| format!("picked folder is not a local path: {e}"))?;
    let canonical = path.canonicalize().map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    s.granted_dirs.lock().map_err(|e| e.to_string())?.push(canonical.clone());
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn read_vault(s: State<AppState>, dir: String) -> Result<Vec<crate::vault::VaultFile>, String> {
    let dir = std::path::PathBuf::from(&dir).canonicalize().map_err(|e| format!("cannot open {dir}: {e}"))?;
    let granted = s.granted_dirs.lock().map_err(|e| e.to_string())?;
    if !granted.iter().any(|g| g == &dir) {
        return Err(format!("{} was not chosen in this session; use \"Choose folder…\"", dir.display()));
    }
    crate::vault::walk_vault(&dir, &crate::vault::DEFAULT_LIMITS)
}
```

Adapt `AppState`'s shape to the existing definition (read `commands.rs` first; if it is a tuple struct `AppState(Mutex<Session>)`, change it to a named-field struct `AppState { session: Mutex<Session>, granted_dirs: Mutex<Vec<PathBuf>> }` and update every `s.0.lock()` to `s.session.lock()`). Register both commands.

- [ ] **Step 6: Run the tests**

Run: `cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(studio-native): pick folders in Rust and read vaults only from picked folders" -m "tauri-plugin-dialog; read_vault refuses any folder not chosen in this session, never follows symlinks, skips dot/tooling dirs, and fails loudly past 5000 notes / 1 MiB per note / 64 MiB total or on non-UTF-8 notes." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Wire the native web UI (no stubs left)

**Files:**

- Modify: `apps/studio/src-tauri/Cargo.toml`, `apps/studio/package.json` (via `pnpm tauri add http`)
- Modify: `apps/studio/src-tauri/capabilities/default.json` (http scope)
- Create: `apps/studio/web/src/native.ts` (native implementations)
- Modify: `apps/studio/web/src/api.ts` (native branches call `native.ts`; `SOON`/`soon` deleted)
- Modify: `apps/studio/web/src/Inspector.tsx` (vault panel: "Choose folder…" in native)
- Test: `apps/studio/web/src/api.test.ts`

**Interfaces:**

- Consumes: Task 2 (`@uniqent/builder/hubs` with `FetchFn`, `skillNameFor`, `fetchSkillMd`, `DEFAULT_MEMORY_REGISTRY`), Task 1 (`@uniqent/builder/memory` `importVault`, `memoryGraph`), Task 3 and 4 commands.
- Produces: `api.chooseFolder(): Promise<string | null>` (native only; browser mode keeps the text field), and native implementations for every former `soon()` method with the same return types as the HTTP branch.

- [ ] **Step 1: Add the http plugin and its scope**

Run: `cd apps/studio && pnpm tauri add http`
Then set the http permission in `src-tauri/capabilities/default.json` to https only:

```json
{
  "identifier": "http:default",
  "allow": [{ "url": "https://*" }, { "url": "https://*/**" }]
}
```

(User-supplied skill URLs and JSON-index URLs can be any host, so the scope is "any https URL"; plain `http:`/`file:` are denied. Record this as a ruling against the spec's "known hosts" wording.)

- [ ] **Step 2: Write the failing web tests**

Extend `apps/studio/web/src/api.test.ts` (it already mocks `@tauri-apps/api/core`); add mocks for the plugins:

```ts
const httpFetchMock = vi.fn();
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: (...a: unknown[]) => httpFetchMock(...a) }));

it('adds a hub MCP result through add_mcp_hub_result with every credential', async () => {
  invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
  const { api } = await import('./api');
  const result = {
    source: 'mcp-registry',
    entry: { id: 'linear', label: 'Linear', description: '', server: { id: 'linear' } },
    credentials: [{ ref: 'linear_token' }],
  };
  await api.addHubMcp(result as never);
  expect(invokeMock).toHaveBeenCalledWith('add_mcp_hub_result', {
    server: { id: 'linear' },
    credentials: [{ ref: 'linear_token' }],
  });
});

it('imports a skill from an https URL via the plugin fetch and names it from frontmatter', async () => {
  httpFetchMock.mockResolvedValue(new Response('---\nname: triage\n---\nBody'));
  invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
  const { api } = await import('./api');
  await api.importSkillFromUrl('https://example.com/triage/SKILL.md');
  expect(invokeMock).toHaveBeenCalledWith('add_custom_skill', {
    name: 'triage',
    skillMd: '---\nname: triage\n---\nBody',
  });
});

it('refuses a non-https skill URL without fetching', async () => {
  const { api } = await import('./api');
  await expect(api.importSkillFromUrl('http://example.com/SKILL.md')).rejects.toThrow(/https/);
  expect(httpFetchMock).not.toHaveBeenCalled();
});

it('previews a vault from Rust-read files with the shared parser', async () => {
  invokeMock.mockImplementation(async (cmd: string) =>
    cmd === 'read_vault'
      ? [
          { path: 'SOUL.md', content: 'I am Atlas.' },
          { path: 'MEMORY.md', content: '- Uses Postgres' },
        ]
      : null,
  );
  const { api } = await import('./api');
  const { result } = await api.previewVault('/picked/vault');
  expect(invokeMock).toHaveBeenCalledWith('read_vault', { dir: '/picked/vault' });
  expect(result.persona).toContain('Atlas');
  expect(result.items.map((i) => i.text)).toContain('Uses Postgres');
});

it('publishes with the stored login token when none is typed', async () => {
  invokeMock.mockImplementation(async (cmd: string) =>
    cmd === 'registry_token'
      ? 'tok'
      : cmd === 'publish_payload'
        ? { slug: 'b', name: 'B', description: '', tags: [], facts: [{ kind: 'fact', text: 't' }] }
        : null,
  );
  httpFetchMock.mockResolvedValue(
    new Response(JSON.stringify({ slug: 'b', factCount: 1 }), { status: 201 }),
  );
  const { api } = await import('./api');
  await api.publishMemory('', 'https://uniqent.ai');
  const [, init] = httpFetchMock.mock.calls[0] as [string, RequestInit];
  expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
});

it('has no "not yet available" stubs left', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('./api.ts', import.meta.url), 'utf8');
  expect(src).not.toMatch(/not yet available in the native app/);
});
```

(`publishMemoryPack` sends the lowercase `authorization: Bearer <token>` header.) Remove the old test that expected `SOON` rejections.

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run apps/studio/web/src/api.test.ts`
Expected: FAIL — native branches still call `soon()`.

- [ ] **Step 4: Implement `native.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  searchMcpHubs,
  searchSkillHubs,
  defaultMcpSources,
  defaultSkillSources,
  searchMemoryHub,
  fetchMemoryPack,
  publishMemoryPack,
  skillNameFor,
  fetchSkillMd,
  DEFAULT_MEMORY_REGISTRY,
  type FetchFn,
  type McpHubResult,
} from '@uniqent/builder/hubs';
import { importVault, memoryGraph } from '@uniqent/builder/memory';
import type { StudioState } from './types';

const fetchFn: FetchFn = (input, init) => tauriFetch(input, init);

export async function hubMcp(query: string) {
  const jsonIndexUrls = await invoke<string[]>('hub_indexes');
  return searchMcpHubs(query, defaultMcpSources({ fetch: fetchFn, jsonIndexUrls }));
}
export async function hubSkills(query: string) {
  const jsonIndexUrls = await invoke<string[]>('hub_indexes');
  return searchSkillHubs(
    query,
    defaultSkillSources({ fetch: fetchFn, jsonIndexUrls, githubToken: undefined }),
  );
}
export function addHubMcp(result: McpHubResult) {
  return invoke<StudioState>('add_mcp_hub_result', {
    server: result.entry.server,
    credentials: result.credentials,
  });
}
export async function addHubSkill(url: string, name: string) {
  const skillMd = await fetchSkillMd(fetchFn, url, undefined);
  return invoke<StudioState>('add_custom_skill', { name, skillMd });
}
export async function importSkillFromUrl(url: string) {
  const skillMd = await fetchSkillMd(fetchFn, url, undefined);
  return invoke<StudioState>('add_custom_skill', { name: skillNameFor(url, skillMd), skillMd });
}
export async function previewVault(dir: string) {
  const result = importVault(
    await invoke<Array<{ path: string; content: string }>>('read_vault', { dir }),
  );
  const graph = memoryGraph(
    result.items.map((it, i) => ({ id: `v${i}`, text: it.text, kind: it.kind })),
  );
  return { result, graph };
}
export async function importVaultDir(dir: string, opts: { persona: boolean; profile: boolean }) {
  const result = importVault(
    await invoke<Array<{ path: string; content: string }>>('read_vault', { dir }),
  );
  if (result.persona && opts.persona) await invoke('set_persona', { persona: result.persona });
  if (result.profile && opts.profile) await invoke('set_profile', { profile: result.profile });
  const state = await invoke<StudioState>('import_memory', {
    payload: {
      items: result.items.map((it) => ({ text: it.text, kind: it.kind, source: it.source })),
    },
  });
  return { state, stats: result.stats };
}
export function searchMemory(query: string, registry: string) {
  return searchMemoryHub(fetchFn, query, registry || DEFAULT_MEMORY_REGISTRY, undefined);
}
export async function addMemoryPack(slug: string, registry: string) {
  const facts = await fetchMemoryPack(
    fetchFn,
    registry || DEFAULT_MEMORY_REGISTRY,
    slug,
    undefined,
  );
  return invoke<StudioState>('import_memory', {
    payload: { items: facts.map((f) => ({ text: f.text, kind: f.kind })) },
  });
}
export async function publishMemory(typedToken: string, registry: string) {
  const reg = registry || DEFAULT_MEMORY_REGISTRY;
  const token = typedToken || (await invoke<string | null>('registry_token', { registry: reg }));
  if (!token)
    throw new Error(`not signed in to ${reg}: run \`uniqent login\` or paste a publish token`);
  const pack = await invoke<Parameters<typeof publishMemoryPack>[3]>('publish_payload');
  return { result: await publishMemoryPack(fetchFn, reg, token, pack, undefined) };
}
export function chooseFolder() {
  return invoke<string | null>('pick_folder');
}
```

Match the exact existing `api.*` return shapes (read the HTTP branch of each method in `api.ts` and the session's return values; e.g. `importVault` returns `{ state, stats }`, `publishMemory` returns `{ result }`). Where `import_memory`'s command returns a count rather than state, follow it with `invoke('state')`. `set_profile` expects string values — pass `result.profile` as produced by `importVault`.

- [ ] **Step 5: Route `api.ts` to `native.ts`; delete the stubs**

For each former `soon()` method, replace `isNative ? soon() : post(...)` with `isNative ? native.<fn>(...) : post(...)` (import `* as native from './native'`). Delete `SOON` and `soon`. Add `chooseFolder: () => (isNative ? native.chooseFolder() : Promise.reject(new Error('folder picking needs the native app')))`.

- [ ] **Step 6: Vault panel uses the native picker**

In `Inspector.tsx` `VaultImportPanel`: when `isNative` (export it from `api.ts`), render a `Choose folder…` button (`data-testid="vault-choose"`) that calls `api.chooseFolder()` and sets `dir` (read-only display of the chosen path); keep the text input for browser mode. Preview/Import stay as they are.

- [ ] **Step 7: Run tests, build the app**

Run: `pnpm vitest run apps/studio && pnpm --filter @uniqent/studio typecheck && pnpm --filter @uniqent/studio build && pnpm --filter @uniqent/studio native:build`
Expected: all green; the native build succeeds.

- [ ] **Step 8: Gates, commit**

```bash
git add -A
git commit -m "feat(studio-native): hubs, skill-from-URL, vault import and memory hub work in the native app" -m "The web UI runs the shared pure builder logic with Tauri's plugin-http fetch (https only) and Rust commands for session state, picked-folder reads and the stored login token. No \"not yet available in the native app\" stubs remain." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Docs and the native smoke

**Files:**

- Modify: `apps/studio/README.md` (native scope paragraph)
- Modify: `CLAUDE.md` (Studio status: Phase 3b native)

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Update docs**

`apps/studio/README.md` — replace the "Phase 3a scope" paragraph's last two sentences with: hubs (MCP/skill/memory search & add), publish (using the `uniqent login` token), skill-from-URL and vault import (via a native folder picker; only picked folders are read) run natively; install-to-agent and capture arrive in Phase 4. Update the matching Studio bullet in `CLAUDE.md` "Current status" in one sentence.

- [ ] **Step 2: Gates**

Run the gates. Expected: all green.

- [ ] **Step 3: Native launch smoke**

```bash
pnpm --filter @uniqent/studio native:build
du -sh "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app"
open "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app"; sleep 5
pgrep -f "Uniqent Studio.app/Contents/MacOS" >/dev/null && echo running
osascript -e 'tell application "Uniqent Studio" to quit'
```

Expected: `running`; app size within ~2 MB of 10 MB (two plugins added). Report the size.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(studio): native Phase 3b scope" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Human check (hand to the user)**

Ask the user to open Studio.app and: search MCP hubs for "github" and add one; search skills and add one; Browse memory hub; Import a vault with "Choose folder…"; Export. Each must work without "not yet available".
