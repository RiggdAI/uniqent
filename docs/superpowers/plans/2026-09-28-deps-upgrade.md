# Dependency Upgrade (sub-project 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every npm and cargo dependency (and Tauri) to the newest version the toolchain supports, with golden fixtures, signatures and Studio's look unchanged.

**Architecture:** Five sequential upgrade groups, one commit each (toolchain → zod/spec → crypto+Rust → Studio UI stack → sweep). Each group bumps versions, applies the known API migrations, then proves nothing changed behaviourally with the existing gates plus the baseline captured in Task 0.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, ESLint, Zod, `@noble/ed25519`, Vite, React, Tailwind, Tiptap, Tauri 2 (Rust: ed25519-dalek, sha2, base64, getrandom).

**Spec:** `docs/superpowers/specs/2026-09-28-studio-native-ship-design.md` (section "Sub-project 1 — Dependency upgrade")

## Global Constraints

- Every dependency goes to its latest version, except where the toolchain makes that impossible; each exception is recorded in the commit body with the reason.
- TypeScript: latest **6.0.x** (typescript-eslint peer is `>=4.8.4 <6.1.0`; 7.x is unsupported).
- `@types/node`: latest **22.x** (tracks the `engines.node >=20` floor).
- `engines.node` stays `>=20` for published packages; the repo toolchain stays Node `>=22.13`.
- Golden fixtures in `apps/studio/fixtures/**` must be byte-identical before and after (same digests and signatures across TS and Rust).
- Generated `packages/spec/schema/uniqent.schema.json` and `docs/SPEC.md` must stay semantically identical: same properties, `required`, `enum`, `pattern`, `const` and types at every path.
- Commit only at each task's final step; conventional commits; end each message with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never hand-edit generated artifacts; regenerate with `pnpm --filter @uniqent/spec gen`.
- Full gate command set (referred to below as **the gates**):
  `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && (cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings)`

## Review Focus

- Tailwind 4 changes defaults (border colour → `currentColor`, `ring` width 3px → 1px, `shadow-sm` → `shadow-xs` rename): Studio must look the same as the Task 0 baseline screenshots — pinned by the screenshot comparison step in Task 4.
- Persona/README editing after Tiptap 3: bold, heading, list typed in the editor must save as markdown, never HTML — pinned by the markdown round-trip check in Task 4.
- Cross-implementation signatures after `@noble/ed25519` 3 and `ed25519-dalek` 3: a Rust-signed export must verify in TS and a TS-signed bundle in Rust — pinned by the fixture hash check and `verify-file.ts` step in Task 3.
- The published CLI on Node 20 with Zod 4 / noble 3 at runtime — pinned by the Node 20 pack-smoke step in Task 5.
- The native app still launches and `invoke()` works after Tauri 2.12 — pinned by the `tauri build` + launch step in Task 4.

---

### Task 0: Capture the baseline

**Files:**

- Create (gitignored): `.playwright-mcp/baseline/*` (screenshots, hashes, schema copy)

**Interfaces:**

- Produces: `.playwright-mcp/baseline/fixtures.sha256`, `.playwright-mcp/baseline/uniqent.schema.json`, `.playwright-mcp/baseline/SPEC.md`, `.playwright-mcp/baseline/studio-*.png`, `.playwright-mcp/baseline/app-size.txt` — later tasks compare against these.

- [ ] **Step 1: Confirm `.playwright-mcp/` is gitignored**

Run: `git check-ignore -v .playwright-mcp/baseline/x`
Expected: a `.gitignore` line matches. If not, stop and report (do not commit baseline files).

- [ ] **Step 2: Run the gates on the untouched tree**

Run the gates (see Global Constraints).
Expected: all green. If anything fails, stop — the baseline must be green.

- [ ] **Step 3: Record fixture hashes and generated spec**

```bash
mkdir -p .playwright-mcp/baseline
find apps/studio/fixtures -type f | sort | xargs shasum -a 256 > .playwright-mcp/baseline/fixtures.sha256
cp packages/spec/schema/uniqent.schema.json docs/SPEC.md .playwright-mcp/baseline/
```

- [ ] **Step 4: Screenshot Studio's key screens**

Start the web Studio: `pnpm --filter @uniqent/studio build && UNIQENT_STUDIO_PORT=4199 pnpm --filter @uniqent/studio start` (background).
With the Playwright MCP tools, open `http://localhost:4199` at 1280×840 and save full-page screenshots into `.playwright-mcp/baseline/`:
`studio-empty.png` (first load), `studio-persona.png` (persona node selected, inspector open), `studio-palette.png` (palette open), `studio-memory-brain.png` (🧠 modal open), `studio-config.png` (Config panel), `studio-narrow.png` (420px width).
Stop the server.

- [ ] **Step 5: Record native app size**

```bash
pnpm --filter @uniqent/studio native:build
du -sh "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app" > .playwright-mcp/baseline/app-size.txt
```

No commit (baseline files are gitignored).

---

### Task 1: Toolchain — pnpm, TypeScript 6.0, ESLint 10, Vitest 5, Prettier, tsx, @types/node

**Files:**

- Modify: `package.json` (root: `packageManager`, devDependencies)
- Modify: `tsconfig.base.json`
- Modify: `eslint.config.js` (only if ESLint 10 requires)
- Modify: every `packages/*/package.json` and `apps/studio/package.json` (vitest, tsx, @types/node devDependencies)
- Modify: `pnpm-lock.yaml`
- Modify: any source file Prettier reformats

**Interfaces:**

- Produces: a green tree on the new toolchain; later tasks assume `tsc` 6.0.x, Vitest 5 and ESLint 10.

- [ ] **Step 1: Bump pnpm**

Set root `package.json` `"packageManager": "pnpm@12.6.0"` (use `npm view pnpm version` for the current latest), then `corepack prepare --activate` and `pnpm -v`.
Expected: the new version prints.

- [ ] **Step 2: Bump the toolchain packages**

```bash
pnpm add -D -w typescript@~6.0 @types/node@^22 eslint@latest @eslint/js@latest typescript-eslint@latest prettier@latest vitest@latest
pnpm -r --filter "./packages/*" --filter "./apps/*" up vitest@latest tsx@latest @types/node@^22
```

Expected: `pnpm-lock.yaml` updated; `pnpm ls typescript -w` shows 6.0.x.

- [ ] **Step 3: Make Node types explicit for TS 6**

TypeScript 6.0 no longer auto-includes every `@types/*` package. Add `"types": ["node"]` to `compilerOptions` in `tsconfig.base.json` (the web tsconfig already sets `"types": ["vite/client"]`):

```json
    "isolatedModules": true,
    "types": ["node"]
```

- [ ] **Step 4: Typecheck and fix TS 6 errors**

Run: `pnpm typecheck`
Expected: PASS. For each error, fix at the root (e.g. a deprecated option → its replacement per the TS 6.0 release notes); never add `// @ts-ignore`.

- [ ] **Step 5: Lint on ESLint 10**

Run: `pnpm lint`
Expected: PASS. If `tseslint.config(...)` is reported as deprecated or removed, switch to `defineConfig` from `eslint/config`, keeping the same blocks:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  {
    ignores: [
      /* unchanged list */
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  /* the two existing rule blocks, unchanged */
);
```

Fix new-rule findings at the root.

- [ ] **Step 6: Reformat with the new Prettier**

Run: `pnpm format && pnpm format:check`
Expected: PASS (formatting-only diffs).

- [ ] **Step 7: Run the gates**

Expected: all green on Vitest 5. If a Vitest 5 breaking change bites (e.g. a config key), fix it in that package's `vitest.config.ts` per the Vitest 5 migration guide.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "build: upgrade toolchain (pnpm 12, TypeScript 6.0, ESLint 10, Vitest 5, Prettier)" -m "TypeScript stays on 6.0.x: typescript-eslint supports <6.1. @types/node stays on 22.x to match the engines floor." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Zod 4 and spec generation

**Files:**

- Modify: `packages/spec/package.json` (zod 4, remove `zod-to-json-schema`)
- Modify: `packages/spec/src/jsonSchema.ts`, `packages/spec/scripts/gen.ts`
- Modify: `packages/spec/src/mcp.ts:27` (single-argument `z.record`)
- Modify: `packages/builder/package.json`, `apps/studio/package.json` (zod 4)
- Modify: `apps/studio/src/server/api.ts:69` (`z.ZodIssue` type)
- Regenerate: `packages/spec/schema/uniqent.schema.json`, `docs/SPEC.md`
- Test: `packages/spec/test/jsonSchema.test.ts`

**Interfaces:**

- Consumes: Task 0 `.playwright-mcp/baseline/uniqent.schema.json`.
- Produces: `buildJsonSchema(): Record<string, unknown>` and `SCHEMA_REGISTRY` with unchanged names; `schemaFor(name: string): Record<string, unknown>` in `jsonSchema.ts` (used by `gen.ts` for per-schema SPEC.md blocks).

- [ ] **Step 1: Bump Zod everywhere and drop the converter**

```bash
pnpm --filter @uniqent/spec --filter @uniqent/builder --filter @uniqent/studio add zod@latest
pnpm --filter @uniqent/spec remove zod-to-json-schema
```

- [ ] **Step 2: Fix Zod 4 API breaks**

`packages/spec/src/mcp.ts:27` — Zod 4 requires both key and value schemas:

```ts
    env: z.record(z.string(), z.string()).optional(),
```

`apps/studio/src/server/api.ts` — use Zod 4's issue type:

```ts
  constructor(route: string, issues: z.core.$ZodIssue[]) {
```

Then run `pnpm typecheck` and fix each remaining Zod error at the root (`ZodTypeAny` → `z.ZodType`; `z.ZodIssueCode.custom` → the string `'custom'` in `ctx.addIssue`).

- [ ] **Step 3: Port the JSON Schema builder to `z.toJSONSchema`**

Replace `packages/spec/src/jsonSchema.ts` body (keep the imports of each schema and `SPEC_VERSION`):

```ts
import { z } from 'zod';
// …existing schema imports unchanged…

/** Named top-level schemas, in document order. The single source for codegen + docs. */
export const SCHEMA_REGISTRY: Record<string, z.ZodType> = {
  Manifest,
  CredentialRequirement,
  PermissionScope,
  McpServersFile,
  MemoryItem,
  MemoryProfile,
  ChannelsFile,
  ToolsFile,
  Task,
  RuntimeConfig,
  Signature,
};

/** One named schema as a standalone draft-07 JSON Schema (all refs inlined). */
export function schemaFor(name: string): Record<string, unknown> {
  const schema = SCHEMA_REGISTRY[name];
  if (!schema)
    throw new Error(`unknown schema "${name}" (known: ${Object.keys(SCHEMA_REGISTRY).join(', ')})`);
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<string, unknown>;
}

/**
 * Builds the canonical single-document JSON Schema (draft-07): Manifest at the root, every named
 * schema under `definitions`. Deterministic — used by both the generator and the drift test.
 */
export function buildJsonSchema(): Record<string, unknown> {
  const definitions = Object.fromEntries(
    Object.keys(SCHEMA_REGISTRY).map((name) => {
      const { $schema: _drop, ...body } = schemaFor(name);
      return [name, body];
    }),
  );
  const { $schema: _drop, ...root } = schemaFor('Manifest');
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://uniqent.dev/schema/uniqent.schema.json',
    title: `Uniqent bundle manifest (specVersion ${SPEC_VERSION})`,
    ...root,
    definitions,
  };
}
```

In `packages/spec/scripts/gen.ts`, replace the `zod-to-json-schema` import and the `zodToJsonSchema(schema, { $refStrategy: 'none' })` call:

```ts
import { buildJsonSchema, SCHEMA_REGISTRY, SPEC_VERSION, schemaFor } from '../src/index.js';
// …
const single = schemaFor(name);
```

Export `schemaFor` from `packages/spec/src/index.ts` if `jsonSchema.ts` exports are not already re-exported with `export *`.

- [ ] **Step 4: Regenerate**

Run: `pnpm --filter @uniqent/spec gen`
Expected: `Wrote …uniqent.schema.json` and `Wrote …SPEC.md`.

- [ ] **Step 5: Prove the schema is semantically identical**

Write a throwaway comparator in the scratchpad (not the repo), `schema-diff.mjs`:

```js
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, 'utf8')));
const facts = (node, path, out) => {
  if (!node || typeof node !== 'object') return out;
  const f = {};
  for (const k of [
    'type',
    'required',
    'enum',
    'pattern',
    'const',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'minItems',
    'additionalProperties',
  ])
    if (k in node) f[k] = JSON.stringify(Array.isArray(node[k]) ? [...node[k]].sort() : node[k]);
  if (node.properties) f.properties = Object.keys(node.properties).sort().join(',');
  if (Object.keys(f).length) out.set(path, f);
  for (const [k, v] of Object.entries(node)) if (k !== '$schema') facts(v, `${path}/${k}`, out);
  return out;
};
const fa = facts(a, '', new Map()),
  fb = facts(b, '', new Map());
let diffs = 0;
for (const p of new Set([...fa.keys(), ...fb.keys()])) {
  const x = JSON.stringify(fa.get(p) ?? null),
    y = JSON.stringify(fb.get(p) ?? null);
  if (x !== y) {
    diffs++;
    console.log(p, '\n  old', x, '\n  new', y);
  }
}
console.log(`${diffs} difference(s)`);
```

Run: `node <scratchpad>/schema-diff.mjs .playwright-mcp/baseline/uniqent.schema.json packages/spec/schema/uniqent.schema.json`
Expected: `0 difference(s)`. Differences that are only representation (e.g. an inlined object where the old file used `$ref`, `anyOf` of one) are acceptable only after confirming the constraint at that path is identical; any real constraint change (a lost `required`, `pattern`, `enum`) must be fixed in `buildJsonSchema`/`schemaFor` (e.g. `io: 'input'` vs `'output'`, or `unrepresentable`/`override` options) until it disappears. Paste the final comparator output into the commit body.

- [ ] **Step 6: Keep the drift test meaningful**

`packages/spec/test/jsonSchema.test.ts` already compares the committed file with `buildJsonSchema()` and checks `definitions`. Run: `pnpm vitest run packages/spec`
Expected: PASS.

- [ ] **Step 7: Run the gates, then commit**

Expected: all green; `git diff --stat apps/studio/fixtures` empty.

```bash
git add -A
git commit -m "build: upgrade to Zod 4 and generate JSON Schema with z.toJSONSchema" -m "zod-to-json-schema does not support Zod 4. Schema comparator vs the pre-upgrade schema: 0 constraint differences." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Crypto and Rust — `@noble/ed25519` 3, Tauri 2.12, ed25519-dalek 3, sha2 0.11, base64 0.23

**Files:**

- Modify: `packages/core/package.json`, `packages/core/src/signing.ts:42-46`
- Modify: `apps/studio/src-tauri/Cargo.toml`, `apps/studio/src-tauri/Cargo.lock`
- Modify: `apps/studio/src-tauri/src/core/signing.rs:21` (key generation), `src/core/digest.rs` (only if sha2 0.11 breaks it), `src/session.rs` (only if base64 0.23 breaks it)
- Modify: `apps/studio/package.json` (`@tauri-apps/api`, `@tauri-apps/cli`)

**Interfaces:**

- Consumes: Task 0 `fixtures.sha256`.
- Produces: unchanged public APIs — `generateKeypair()`, `sign()`, `verify()` (TS) and the Rust `signing` module functions keep their signatures.

- [ ] **Step 1: Bump noble**

Run: `pnpm --filter @uniqent/core add @noble/ed25519@latest`

- [ ] **Step 2: Migrate `generateKeypair` to the v3 API**

In v3, `utils.randomPrivateKey` is renamed `utils.randomSecretKey` (check the v3 README "Upgrading" section; `getPublicKeyAsync`, `signAsync`, `verifyAsync` keep their names). In `packages/core/src/signing.ts`:

```ts
export async function generateKeypair(): Promise<Keypair> {
  const priv = ed.utils.randomSecretKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { privateKey: toHex(priv), publicKey: toHex(pub) };
}
```

If `verifyAsync`'s default options changed in v3 (e.g. `zip215`), pass the option that matches v2's behaviour explicitly so existing signatures verify identically.

- [ ] **Step 3: Core tests and fixture hashes**

Run: `pnpm --filter @uniqent/core build && pnpm vitest run packages/core apps/studio/test/core-fixtures.test.ts`
Expected: PASS.
Run: `find apps/studio/fixtures -type f | sort | xargs shasum -a 256 | diff - .playwright-mcp/baseline/fixtures.sha256`
Expected: no output.

- [ ] **Step 4: Bump Tauri and Rust crates**

In `apps/studio/src-tauri/Cargo.toml` set `tauri-build = { version = "2.7", … }`, `tauri = { version = "2.12", … }`, `ed25519-dalek = { version = "3", features = ["rand_core"] }` → replace with `ed25519-dalek = "3"`, `sha2 = "0.11"`, `base64 = "0.23"`, remove `rand = "0.8"`, add `getrandom = "0.4"`. Then:

```bash
pnpm --filter @uniqent/studio add -D @tauri-apps/cli@latest @tauri-apps/api@latest
cd apps/studio/src-tauri && cargo update
```

- [ ] **Step 5: Seed signing keys from getrandom (drops the rand/rand_core version coupling)**

In `apps/studio/src-tauri/src/core/signing.rs`, replace `SigningKey::generate(&mut rand::rngs::OsRng)` with:

```rust
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed).map_err(|e| format!("OS random source unavailable: {e}"))?;
    let sk = SigningKey::from_bytes(&seed);
```

Match the surrounding function's error type (if it returns `Result<_, String>` this compiles as-is; otherwise convert with the function's existing error type). Confirm `getrandom::fill` is the 0.4 API on docs.rs; adjust the call name only if docs.rs shows otherwise.

- [ ] **Step 6: Build and fix remaining API breaks**

Run: `cd apps/studio/src-tauri && cargo build`
Fix each error at the root. Known candidates: `Sha256::finalize()` returns `hybrid_array::Array` in sha2 0.11 — `hex::encode(h.finalize())` keeps working via `AsRef<[u8]>`; if not, use `hex::encode(h.finalize().as_slice())`.

- [ ] **Step 7: Rust tests, clippy, fixture hashes, cross-verification**

```bash
cd apps/studio/src-tauri && cargo test && cargo clippy --all-targets -- -D warnings && cd ../../..
find apps/studio/fixtures -type f | sort | xargs shasum -a 256 | diff - .playwright-mcp/baseline/fixtures.sha256
```

Expected: tests green, clippy clean, no hash diff.
Cross-verify a fresh Rust-signed export with the TS verifier:

```bash
cd apps/studio/src-tauri && cargo test --test export_test write_exchange_artifact -- --ignored && cd ..
pnpm exec tsx scripts/verify-file.ts src-tauri/target/exchange-test.uniqent && cd ../..
```

Expected: the last line is `OK: TS core verifies this bundle`.

- [ ] **Step 8: Run the gates, then commit**

```bash
git add -A
git commit -m "build: upgrade crypto and Tauri (noble ed25519 3, Tauri 2.12, ed25519-dalek 3, sha2 0.11, base64 0.23)" -m "Rust signing keys now come from getrandom, removing the rand dependency. Golden fixtures unchanged." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Studio UI stack — Vite 8, React 19.3, Tailwind 4, Tiptap 3, xyflow, radix, lucide, force-graph

**Files:**

- Modify: `apps/studio/package.json`
- Modify: `apps/studio/web/vite.config.ts`
- Modify: `apps/studio/web/src/index.css`
- Delete: `apps/studio/web/tailwind.config.js`, `apps/studio/web/postcss.config.js` (only if the upgrade tool moves everything into CSS)
- Modify: any `apps/studio/web/src/**/*.tsx` class names the Tailwind upgrade tool rewrites
- Modify: `apps/studio/web/src/components/ui/rich-editor.tsx` (only if Tiptap 3 / tiptap-markdown 0.9 APIs differ)

**Interfaces:**

- Consumes: Task 0 screenshots and `app-size.txt`.
- Produces: a Studio that looks identical to the baseline.

- [ ] **Step 1: Bump the UI dependencies**

```bash
pnpm --filter @uniqent/studio add react@latest react-dom@latest @xyflow/react@latest @radix-ui/react-label@latest @radix-ui/react-slot@latest lucide-react@latest react-force-graph-2d@latest react-force-graph-3d@latest class-variance-authority@latest clsx@latest tailwind-merge@latest @tiptap/pm@latest @tiptap/react@latest @tiptap/starter-kit@latest tiptap-markdown@latest
pnpm --filter @uniqent/studio add -D vite@latest @vitejs/plugin-react@latest @types/react@latest @types/react-dom@latest
```

(`react`/`react-dom` stay where they are listed today — devDependencies; keep that placement.)

- [ ] **Step 2: Run the official Tailwind upgrade tool**

```bash
cd apps/studio/web && npx @tailwindcss/upgrade@latest && cd -
```

Review its diff: `@tailwind` directives → `@import "tailwindcss";`, theme moved to `@theme`, renamed utilities (`shadow-sm`→`shadow-xs`, `rounded-sm`→`rounded-xs`, `outline-none`→`outline-hidden`, …) rewritten in `.tsx`.

- [ ] **Step 3: Replace tailwindcss-animate and PostCSS with the Vite plugin**

```bash
pnpm --filter @uniqent/studio remove tailwindcss-animate autoprefixer postcss
pnpm --filter @uniqent/studio add -D tailwindcss@latest @tailwindcss/vite@latest tw-animate-css@latest
```

In `apps/studio/web/vite.config.ts`:

```ts
import tailwindcss from '@tailwindcss/vite';
// …
  plugins: [react(), tailwindcss()],
```

At the top of `apps/studio/web/src/index.css`, after `@import "tailwindcss";`, add `@import "tw-animate-css";` and remove any `@plugin "tailwindcss-animate"` line the tool added. Delete `postcss.config.js` and `tailwind.config.js` once nothing references them (if the tool left an `@config` line pointing at the JS config, port its remaining theme to `@theme` and remove the `@config`).

Preserve v3 defaults the design relies on by adding to `index.css` (Tailwind's documented v3-compat snippet):

```css
@layer base {
  *,
  ::after,
  ::before,
  ::backdrop,
  ::file-selector-button {
    border-color: var(--color-gray-200, currentColor);
  }
}
```

and replace `var(--color-gray-200, currentColor)` with `hsl(var(--border))` so borders keep the design token.

- [ ] **Step 4: Rich editor on Tiptap 3**

Run: `pnpm --filter @uniqent/studio typecheck`
Fix `rich-editor.tsx` at the root if needed (tiptap-markdown 0.9 keeps `editor.storage.markdown.getMarkdown()`; Tiptap 3 keeps `useEditor`/`EditorContent`, and `immediatelyRender: false` stays).

- [ ] **Step 5: Build, test, and compare against the baseline screenshots**

Run: `pnpm --filter @uniqent/studio build && pnpm vitest run apps/studio`
Expected: PASS.
Start the web Studio on `:4199` again and take the same six screenshots as Task 0 into `.playwright-mcp/after/`. Compare each pair side by side (open both images). Expected: no visible difference in colours, borders, rings, shadows, spacing or layout. Fix any difference in `index.css`/class names, re-screenshot until equal.

- [ ] **Step 6: Markdown round-trip in the persona editor**

In the running Studio: select the persona node, type a heading, a bold word and a bullet list in the rich editor, then export (or call `GET /api/state`) and read the persona text.
Expected: markdown (`# `, `**word**`, `- item`), no HTML tags.

- [ ] **Step 7: Native build, size and launch**

```bash
pnpm --filter @uniqent/studio native:build
du -sh "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app"
open "apps/studio/src-tauri/target/release/bundle/macos/Uniqent Studio.app"
```

Expected: size within ~1 MB of `.playwright-mcp/baseline/app-size.txt`; the app opens, the canvas renders, adding a persona and exporting works (invoke path). Report the size.

- [ ] **Step 8: Run the gates, then commit**

```bash
git add -A
git commit -m "build(studio): upgrade UI stack (Vite 8, React 19.3, Tailwind 4, Tiptap 3, xyflow, lucide)" -m "Tailwind 4 via @tailwindcss/vite; tailwindcss-animate replaced by tw-animate-css; visual parity checked against baseline screenshots." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Sweep the remainder and prove the release path

**Files:**

- Modify: remaining `package.json` files (`tar-stream`, `yaml`, `json5`, `@types/*`, anything else reported)
- Modify: `pnpm-lock.yaml`
- Modify: `CLAUDE.md` ("Repo conventions" line on TypeScript/pnpm versions)

**Interfaces:**

- Consumes: all previous tasks.
- Produces: `pnpm -r outdated` lists only the documented pins.

- [ ] **Step 1: Update everything still outdated**

Run: `pnpm -r outdated`
For every row except `typescript` (6.0 pin) and `@types/node` (22.x pin): `pnpm --filter <dependent> add <pkg>@latest` (use `-D` for devDependencies).
Run: `pnpm -r outdated` again.
Expected: only `typescript` and `@types/node` rows remain.

- [ ] **Step 2: Rust sweep**

Run: `cd apps/studio/src-tauri && cargo update && cargo tree --depth 1`
For any direct dependency below its crates.io `max_stable_version` (check with `cargo search <crate> --limit 1`), bump the `Cargo.toml` requirement and rebuild.

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md` "Repo conventions", change the TypeScript bullet to state the pins:

```markdown
- TypeScript 6.0.x (typescript-eslint supports <6.1), Node 22.13+ for the toolchain, pnpm 12, **ESM only**. pnpm workspaces monorepo (`packages/*`).
```

- [ ] **Step 4: Run the gates**

Expected: all green; `find apps/studio/fixtures -type f | sort | xargs shasum -a 256 | diff - .playwright-mcp/baseline/fixtures.sha256` prints nothing.

- [ ] **Step 5: Pack-smoke the CLI on Node 22 and Node 20**

```bash
S=$(mktemp -d); for p in packages/*; do (cd $p && pnpm pack --pack-destination $S/tgz >/dev/null); done
mkdir $S/app && cd $S/app && npm init -y >/dev/null && npm i --no-audit --no-fund $S/tgz/*.tgz
for t in claude-code hermes openclaw; do mkdir -p $S/r-$t; HOME=$S npx uniqent try research-analyst --target $t --root $S/r-$t --yes </dev/null || echo "FAIL $t"; done
HOME=$S npx -y -p node@20 node node_modules/@uniqent/cli/dist/bin.js try research-analyst --target claude-code --root $S/r-node20 --yes </dev/null || echo "FAIL node20"
cd - >/dev/null
```

Expected: no `FAIL` lines.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "build: update remaining dependencies to latest" -m "Pinned: typescript 6.0.x (typescript-eslint <6.1), @types/node 22.x (engines floor)." -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
