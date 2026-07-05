# Studio Native Phase 1 (Tauri Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running native Studio.app (Tauri v2, macOS) hosting the existing SPA, with the pure-state API implemented in Rust and everything else gracefully stubbed.

**Architecture:** `src-tauri/` is added to `apps/studio`. The SPA's single API module (`web/src/api.ts`) is re-pointed at Tauri `invoke()` for 9 pure-state methods; all other methods reject with a friendly "coming soon" error the existing UI already renders. Rust holds the brain draft in managed state and must produce `state()`/`catalog()` JSON **identical** to the TS session — enforced by golden fixtures emitted from the TS implementation and asserted byte-for-byte (as JSON values) in `cargo test`.

**Tech Stack:** Tauri v2 (Rust 2021, `serde`/`serde_json`, `base64`), the existing Vite/React SPA, tsx (fixture emission), Vitest, pnpm.

## Global Constraints

- Repo `uniqent`, branch `feat/studio-native`. Commit there.
- macOS first; nothing that blocks Windows/Linux later (no mac-only APIs outside Tauri's own).
- Keep it lite: no Node/Bun sidecar, no new JS runtime deps in the app bundle.
- The SPA is reused: **only `web/src/api.ts` may change** in `web/src` (plus a types import if needed). All other SPA files untouched.
- Contract: Rust `state()` and `catalog()` must JSON-equal the TS session's output for the same inputs (golden fixtures in `apps/studio/fixtures/`). `avatar` is excluded from the mutation fixture (validated by Rust-only unit tests instead).
- Phase-1 command set (exactly these; everything else stubbed in the shim): `state`, `catalog`, `set_meta`, `set_targets`, `set_persona`, `set_readme`, `set_avatar`, `remove_avatar`, `reset`.
- Stub message (exact string): `not yet available in the native app — coming in a later phase`.
- Avatar rule (match TS): only `data:image/(png|jpeg|webp);base64,` URLs, decoded size ≤ 512 KB, error `avatar too large (max 512KB)`.
- The legacy Node server (`src/server`) stays untouched this phase (deleted in Phase 4).
- Gates per task: `pnpm --filter @uniqent/studio typecheck` + existing Vitest suites green; from Task 1 on also `cargo check` (Task 3+: `cargo test`, final: `cargo clippy -- -D warnings`) run inside `apps/studio/src-tauri`.
- Prerequisite (Task 1 Step 1): Rust is NOT installed on this machine — install via rustup (user-approved system install). Xcode CLT is present.
- Commit after every task. DRY, YAGNI, TDD.

---

## File Structure

- `apps/studio/src-tauri/Cargo.toml`, `tauri.conf.json`, `build.rs`, `icons/`, `.gitignore` (create) — Tauri app scaffold.
- `apps/studio/src-tauri/src/main.rs` (create) — entry; registers commands + managed state.
- `apps/studio/src-tauri/src/session.rs` (create) — `Draft` state + `state()`/`catalog()` assembly.
- `apps/studio/src-tauri/src/commands.rs` (create) — the 9 `#[tauri::command]`s.
- `apps/studio/src-tauri/tests/fixtures_test.rs` (create) — fixture-equality tests.
- `apps/studio/scripts/emit-fixtures.ts` (create) — emits fixtures from the TS session.
- `apps/studio/fixtures/{state-default.json,state-mutated.json,catalog.json}` (create, generated).
- `apps/studio/test/fixtures.test.ts` (create) — TS drift guard.
- `apps/studio/web/src/api.ts` (modify) — Tauri shim + stubs.
- `apps/studio/web/src/api.test.ts` (create) — shim unit tests (mocked invoke).
- `apps/studio/package.json` (modify) — `native:dev`, `native:build`, `fixtures` scripts.
- `apps/studio/README.md` (create/modify) — native dev docs.

---

## Task 1: Rust toolchain + Tauri v2 scaffold

**Files:**

- Create: `apps/studio/src-tauri/Cargo.toml`, `apps/studio/src-tauri/tauri.conf.json`, `apps/studio/src-tauri/build.rs`, `apps/studio/src-tauri/src/main.rs`, `apps/studio/src-tauri/.gitignore`, `apps/studio/src-tauri/icons/*`
- Modify: `apps/studio/package.json` (scripts + `@tauri-apps/cli` devDep)

**Interfaces:**

- Produces: a bootable Tauri app whose window loads the SPA (`pnpm --filter @uniqent/studio native:dev`); `invoke('state')` etc. not yet registered (added in Task 3 — the app compiles with zero commands).

- [ ] **Step 1: Install the Rust toolchain (system prerequisite — may prompt for approval)**

```bash
command -v cargo >/dev/null 2>&1 || curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
source "$HOME/.cargo/env"
cargo --version && rustc --version
```

Expected: `cargo 1.8x`, `rustc 1.8x` print. If the install is denied, STOP and report BLOCKED (nothing in this plan proceeds without cargo).

- [ ] **Step 2: Add the Tauri CLI and scripts**

```bash
pnpm --filter @uniqent/studio add -D @tauri-apps/cli@^2 @tauri-apps/api@^2
```

In `apps/studio/package.json` scripts, add:

```json
    "native:dev": "tauri dev",
    "native:build": "tauri build",
```

- [ ] **Step 3: Create the scaffold files**

`apps/studio/src-tauri/Cargo.toml`:

```toml
[package]
name = "uniqent-studio"
version = "0.1.0"
edition = "2021"

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
base64 = "0.22"

[profile.release]
lto = true
codegen-units = 1
strip = true
```

`apps/studio/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`apps/studio/src-tauri/src/main.rs` (minimal boot; commands land in Task 3):

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running uniqent studio");
}
```

`apps/studio/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Uniqent Studio",
  "version": "0.1.0",
  "identifier": "ai.uniqent.studio",
  "build": {
    "beforeDevCommand": "pnpm dev:web",
    "devUrl": "http://localhost:5173",
    "beforeBuildCommand": "pnpm build:web",
    "frontendDist": "../dist-web"
  },
  "app": {
    "windows": [
      {
        "title": "Uniqent Studio",
        "width": 1280,
        "height": 840,
        "minWidth": 960,
        "minHeight": 640
      }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": ["app", "dmg"],
    "icon": ["icons/icon.icns", "icons/icon.png"]
  }
}
```

`apps/studio/src-tauri/.gitignore`:

```
/target
```

Icons: generate the default set from any 1024×1024 PNG (solid placeholder is fine this phase):

```bash
cd apps/studio && pnpm exec tauri icon ../../docs/assets/logo.png 2>/dev/null || {
  # no logo asset: make a plain placeholder with sips (macOS built-in)
  mkdir -p /tmp/unq-icon && sips -s format png --resampleWidth 1024 /System/Library/CoreServices/DefaultDesktop.heic --out /tmp/unq-icon/icon.png >/dev/null 2>&1 || true
  pnpm exec tauri icon /tmp/unq-icon/icon.png
}
```

(If both fail, create a 1024×1024 PNG any other reproducible way — the only requirement is `icons/icon.icns` + `icons/icon.png` exist.)

- [ ] **Step 4: Verify it compiles and boots**

```bash
cd apps/studio/src-tauri && source "$HOME/.cargo/env" && cargo check
```

Expected: `Finished` with no errors (first run downloads crates; minutes).

Vite dev-server check for the dev wiring (`devUrl` must match `dev:web`'s port — Vite defaults to 5173; if `web/vite.config.ts` sets another port, update `devUrl` to match and note it).

- [ ] **Step 5: Typecheck + existing tests still green**

```bash
pnpm --filter @uniqent/studio typecheck && pnpm --filter @uniqent/studio test
```

Expected: PASS (scaffold touches no TS behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src-tauri apps/studio/package.json pnpm-lock.yaml
git commit -m "feat(studio): Tauri v2 scaffold for native Studio (macOS)"
```

---

## Task 2: Golden fixtures from the TS session

**Files:**

- Create: `apps/studio/scripts/emit-fixtures.ts`
- Create: `apps/studio/fixtures/state-default.json`, `apps/studio/fixtures/state-mutated.json`, `apps/studio/fixtures/catalog.json` (generated)
- Create: `apps/studio/test/fixtures.test.ts`
- Modify: `apps/studio/package.json` (`"fixtures": "tsx scripts/emit-fixtures.ts"`)

**Interfaces:**

- Produces: the three committed fixture files — the _contract_ Task 3's Rust must match. The **canonical mutation script** (used identically in TS here and Rust in Task 3):
  1. `setMeta({ name: 'fixture-brain', description: 'A fixture brain for cross-impl tests', version: '1.2.3' })`
  2. `setTargets(['claude-code', 'hermes'])`
  3. `setPersona('# Persona\n\nYou are the fixture.')`
  4. `setReadme('# Readme\n\nFixture readme.')`

- [ ] **Step 1: Write the emit script**

`apps/studio/scripts/emit-fixtures.ts`:

```typescript
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioSession } from '../src/server/session.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
await mkdir(out, { recursive: true });

const write = (name: string, data: unknown) =>
  writeFile(join(out, name), JSON.stringify(data, null, 2) + '\n');

const s = new StudioSession();
await write('state-default.json', s.state());
await write('catalog.json', s.catalog());

// Canonical mutation script — keep in lockstep with src-tauri/tests/fixtures_test.rs.
s.setMeta({
  name: 'fixture-brain',
  description: 'A fixture brain for cross-impl tests',
  version: '1.2.3',
});
s.setTargets(['claude-code', 'hermes']);
s.setPersona('# Persona\n\nYou are the fixture.');
s.setReadme('# Readme\n\nFixture readme.');
await write('state-mutated.json', s.state());

console.log('fixtures written to', out);
```

- [ ] **Step 2: Generate and inspect**

```bash
pnpm --filter @uniqent/studio fixtures
cat apps/studio/fixtures/state-default.json | head -30
```

Expected: three files; `state-default.json` has `manifest`, `validation`, and no `persona`/`readme`/`avatar` keys (or explicit absent semantics — record what you see; Task 3 must match it exactly).

- [ ] **Step 3: Write the TS drift guard**

`apps/studio/test/fixtures.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StudioSession } from '../src/server/session.js';

const fx = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8')) as unknown;

describe('golden fixtures stay in sync with the TS session', () => {
  it('default state matches state-default.json', () => {
    expect(JSON.parse(JSON.stringify(new StudioSession().state()))).toEqual(
      fx('state-default.json'),
    );
  });
  it('catalog matches catalog.json', () => {
    expect(JSON.parse(JSON.stringify(new StudioSession().catalog()))).toEqual(fx('catalog.json'));
  });
  it('the canonical mutation script matches state-mutated.json', () => {
    const s = new StudioSession();
    s.setMeta({
      name: 'fixture-brain',
      description: 'A fixture brain for cross-impl tests',
      version: '1.2.3',
    });
    s.setTargets(['claude-code', 'hermes']);
    s.setPersona('# Persona\n\nYou are the fixture.');
    s.setReadme('# Readme\n\nFixture readme.');
    expect(JSON.parse(JSON.stringify(s.state()))).toEqual(fx('state-mutated.json'));
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @uniqent/studio test
```

Expected: PASS (all existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/scripts/emit-fixtures.ts apps/studio/fixtures apps/studio/test/fixtures.test.ts apps/studio/package.json
git commit -m "feat(studio): golden state/catalog fixtures from the TS session"
```

---

## Task 3: Rust session + the 9 commands (fixture-driven TDD)

**Files:**

- Create: `apps/studio/src-tauri/src/session.rs`, `apps/studio/src-tauri/src/commands.rs`
- Modify: `apps/studio/src-tauri/src/main.rs`
- Test: `apps/studio/src-tauri/tests/fixtures_test.rs`

**Interfaces:**

- Consumes: `apps/studio/fixtures/*.json` (Task 2).
- Produces (for Task 4): Tauri commands registered under these exact names, all returning the full state JSON (like today's endpoints) except `catalog`:
  - `state() -> Value`, `catalog() -> Value`, `reset() -> Value`
  - `set_meta(meta: Value) -> Value` (accepts `{name?, description?, version?}` partials)
  - `set_targets(targets: Vec<String>) -> Value`
  - `set_persona(persona: String) -> Value`, `set_readme(readme: String) -> Value`
  - `set_avatar(data_url: String) -> Result<Value, String>`, `remove_avatar() -> Value`
- **Correctness contract:** `Session::state()` and `Session::catalog()` return `serde_json::Value`s equal to the fixtures for the same inputs. Derive the manifest/validation assembly by reading `fixtures/state-default.json` + `fixtures/state-mutated.json` (the exact expected outputs), with `packages/spec/src` (Manifest shape) and `packages/core/src/validate.ts` (validation rules) as reference — implement ONLY what phase-1 content can produce (no components). The fixture tests are the acceptance gate; do not guess fields.

- [ ] **Step 1: Write the failing fixture tests**

`apps/studio/src-tauri/tests/fixtures_test.rs`:

```rust
use serde_json::Value;
use uniqent_studio::session::Session;

fn fixture(name: &str) -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/");
    let raw = std::fs::read_to_string(format!("{p}{name}")).expect("fixture readable");
    serde_json::from_str(&raw).expect("fixture is JSON")
}

#[test]
fn default_state_matches_fixture() {
    assert_eq!(Session::new().state(), fixture("state-default.json"));
}

#[test]
fn catalog_matches_fixture() {
    assert_eq!(Session::new().catalog(), fixture("catalog.json"));
}

#[test]
fn canonical_mutations_match_fixture() {
    let mut s = Session::new();
    s.set_meta(serde_json::json!({
        "name": "fixture-brain",
        "description": "A fixture brain for cross-impl tests",
        "version": "1.2.3"
    }));
    s.set_targets(vec!["claude-code".into(), "hermes".into()]);
    s.set_persona("# Persona\n\nYou are the fixture.".into());
    s.set_readme("# Readme\n\nFixture readme.".into());
    assert_eq!(s.state(), fixture("state-mutated.json"));
}

#[test]
fn avatar_roundtrip_and_size_limit() {
    let mut s = Session::new();
    // 1x1 png data url
    let ok = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    s.set_avatar(ok.to_string()).expect("small avatar accepted");
    assert!(s.state()["avatar"].as_str().unwrap().starts_with("data:image/png;base64,"));
    s.remove_avatar();
    assert!(s.state().get("avatar").is_none() || s.state()["avatar"].is_null());

    let big = format!("data:image/png;base64,{}", "A".repeat(700 * 1024)); // > 512KB decoded
    let err = s.set_avatar(big).unwrap_err();
    assert!(err.contains("avatar too large (max 512KB)"));
}

#[test]
fn reset_returns_to_default() {
    let mut s = Session::new();
    s.set_persona("changed".into());
    s.reset();
    assert_eq!(s.state(), fixture("state-default.json"));
}
```

(This requires the crate to expose a library target: add `src/lib.rs` with `pub mod session;` and in `Cargo.toml` a `[lib] name = "uniqent_studio"` section alongside the binary — do that in this task.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/studio/src-tauri && source "$HOME/.cargo/env" && cargo test
```

Expected: FAIL — `session` module does not exist.

- [ ] **Step 3: Implement `session.rs`**

Structure (the manifest/validation assembly comes from the fixtures — see the contract above):

```rust
use serde_json::{json, Map, Value};

pub struct Session {
    name: String,
    description: String,
    version: String,
    targets: Vec<String>,
    persona: Option<String>,
    readme: Option<String>,
    avatar: Option<String>, // data: URL, validated on set
}

impl Session {
    pub fn new() -> Self { /* defaults matching state-default.json */ }
    pub fn state(&self) -> Value { /* { manifest, validation, persona?, readme?, avatar? } per fixtures */ }
    pub fn catalog(&self) -> Value { /* embedded fixtures/catalog.json via include_str! */ }
    pub fn set_meta(&mut self, meta: Value) { /* apply present keys only */ }
    pub fn set_targets(&mut self, targets: Vec<String>) { /* replace */ }
    pub fn set_persona(&mut self, md: String) { /* empty string clears (match TS) */ }
    pub fn set_readme(&mut self, md: String) { /* empty string clears (match TS) */ }
    pub fn set_avatar(&mut self, data_url: String) -> Result<(), String> {
        // must start with data:image/(png|jpeg|webp);base64, ; decode base64; len <= 512*1024
        // else Err("avatar too large (max 512KB)".into()) / Err("unsupported avatar format".into())
    }
    pub fn remove_avatar(&mut self) { self.avatar = None; }
    pub fn reset(&mut self) { *self = Session::new(); }
}
```

`catalog()` embeds the fixture (single source of truth this phase):

```rust
pub fn catalog(&self) -> Value {
    serde_json::from_str(include_str!("../../fixtures/catalog.json")).expect("catalog.json valid")
}
```

Check the TS session for the exact clear-semantics of empty persona/readme (`setPersona('')`) and mirror it; the mutated fixture plus a quick read of `session.ts` settles any ambiguity.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cargo test
```

Expected: 5/5 PASS. Iterate on `state()` assembly until the fixture equality holds — the diff `assert_eq!` prints is the porting to-do list.

- [ ] **Step 5: Register the commands**

`apps/studio/src-tauri/src/commands.rs`:

```rust
use std::sync::Mutex;
use serde_json::Value;
use tauri::State;
use crate::session::Session;

pub struct AppState(pub Mutex<Session>);

#[tauri::command]
pub fn state(s: State<AppState>) -> Value { s.0.lock().unwrap().state() }

#[tauri::command]
pub fn catalog(s: State<AppState>) -> Value { s.0.lock().unwrap().catalog() }

#[tauri::command]
pub fn set_meta(s: State<AppState>, meta: Value) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_meta(meta); g.state()
}

#[tauri::command]
pub fn set_targets(s: State<AppState>, targets: Vec<String>) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_targets(targets); g.state()
}

#[tauri::command]
pub fn set_persona(s: State<AppState>, persona: String) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_persona(persona); g.state()
}

#[tauri::command]
pub fn set_readme(s: State<AppState>, readme: String) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_readme(readme); g.state()
}

#[tauri::command]
pub fn set_avatar(s: State<AppState>, data_url: String) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap(); g.set_avatar(data_url)?; Ok(g.state())
}

#[tauri::command]
pub fn remove_avatar(s: State<AppState>) -> Value {
    let mut g = s.0.lock().unwrap(); g.remove_avatar(); g.state()
}

#[tauri::command]
pub fn reset(s: State<AppState>) -> Value {
    let mut g = s.0.lock().unwrap(); g.reset(); g.state()
}
```

`main.rs` becomes:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use uniqent_studio::commands::{self, AppState};
use uniqent_studio::session::Session;

fn main() {
    tauri::Builder::default()
        .manage(AppState(Mutex::new(Session::new())))
        .invoke_handler(tauri::generate_handler![
            commands::state, commands::catalog, commands::set_meta, commands::set_targets,
            commands::set_persona, commands::set_readme, commands::set_avatar,
            commands::remove_avatar, commands::reset
        ])
        .run(tauri::generate_context!())
        .expect("error while running uniqent studio");
}
```

(`lib.rs`: `pub mod commands; pub mod session;` — commands needs the `tauri` dependency available to the lib target.)

- [ ] **Step 6: Full gate**

```bash
cargo test && cargo check && cd ../../.. && pnpm --filter @uniqent/studio typecheck && pnpm --filter @uniqent/studio test
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src-tauri
git commit -m "feat(studio): Rust session + pure-state Tauri commands (fixture-verified)"
```

---

## Task 4: api-client shim + graceful stubs

**Files:**

- Modify: `apps/studio/web/src/api.ts`
- Test: `apps/studio/web/src/api.test.ts` (create)

**Interfaces:**

- Consumes: Task 3's command names (`state`, `catalog`, `set_meta`, `set_targets`, `set_persona`, `set_readme`, `set_avatar`, `remove_avatar`, `reset`).
- Produces: the same exported `api` object the SPA already uses — signatures unchanged.

- [ ] **Step 1: Write the failing shim test**

`apps/studio/web/src/api.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

describe('api shim (native)', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ = {}; // native detection
    vi.resetModules();
  });

  it('routes implemented methods through invoke with mapped args', async () => {
    invokeMock.mockResolvedValue({ manifest: {}, validation: { ok: true } });
    const { api } = await import('./api');
    await api.setPersona('hello');
    expect(invokeMock).toHaveBeenCalledWith('set_persona', { persona: 'hello' });
    await api.setMeta({ name: 'x' });
    expect(invokeMock).toHaveBeenCalledWith('set_meta', { meta: { name: 'x' } });
    await api.removeAvatar();
    expect(invokeMock).toHaveBeenCalledWith('remove_avatar');
  });

  it('rejects unimplemented methods with the coming-soon message', async () => {
    const { api } = await import('./api');
    await expect(api.exportBundle?.() ?? api.memoryGraph()).rejects.toThrow(
      /not yet available in the native app/,
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('falls back to fetch when not running under Tauri', async () => {
    delete (globalThis as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.resetModules();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api');
    await api.state();
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

(Adjust the unimplemented-method call to a real method name from `api.ts` — e.g. `memoryGraph`; check `exportBundle`'s actual name in the file. The web tsconfig/vitest must include `web/src/*.test.ts` — extend `vitest.config.ts` include if needed.)

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm --filter @uniqent/studio test -- api
```

Expected: FAIL (`api.ts` has no Tauri path).

- [ ] **Step 3: Implement the shim in `web/src/api.ts`**

Keep the existing `get`/`post` helpers and every exported signature. Add at the top:

```typescript
import { invoke } from '@tauri-apps/api/core';

const isNative = typeof (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined';

const SOON = 'not yet available in the native app — coming in a later phase';
const soon = () => Promise.reject(new Error(SOON));
```

Then rebuild the `api` object so each method has a native route:

- Implemented 9 → `invoke('<command>', argsObject)` (args exactly as in the Task 4 test: `set_meta` takes `{ meta }`, `set_targets` `{ targets }`, `set_persona` `{ persona }`, `set_readme` `{ readme }`, `set_avatar` `{ dataUrl: … }` → **note:** Tauri v2 converts JS camelCase arg keys to the Rust snake_case parameter (`dataUrl` → `data_url`) automatically; pass `{ dataUrl }`).
- All other methods → `soon()` when `isNative`, existing fetch path otherwise.

Pattern (compact — apply to the whole object):

```typescript
export const api = {
  state: () => (isNative ? invoke<StudioState>('state') : get<StudioState>('/api/state')),
  catalog: () => (isNative ? invoke<CatalogView>('catalog') : get<CatalogView>('/api/catalog')),
  setMeta: (meta: Record<string, unknown>) =>
    isNative ? invoke<StudioState>('set_meta', { meta }) : post<StudioState>('/api/meta', meta),
  // …same for setTargets/setPersona/setReadme/setAvatar/removeAvatar/reset…
  addMemory: (text: string, importance?: number) =>
    isNative ? soon() : post<StudioState>('/api/memory', { text, importance }),
  // …every remaining method gets the isNative? soon() : <existing fetch> guard…
};
```

- [ ] **Step 4: Run tests + typecheck**

```bash
pnpm --filter @uniqent/studio test && pnpm --filter @uniqent/studio typecheck
```

Expected: PASS (new shim tests + all existing suites — the browser/server tests still exercise the fetch path).

- [ ] **Step 5: Commit**

```bash
git add apps/studio/web/src/api.ts apps/studio/web/src/api.test.ts apps/studio/vitest.config.ts
git commit -m "feat(studio): api client routes to Tauri invoke; stubs later-phase features"
```

---

## Task 5: End-to-end wiring, clippy, docs

**Files:**

- Modify: `apps/studio/README.md` (create if absent)
- Possibly touch: `apps/studio/src-tauri/tauri.conf.json` (only if the dev/build wiring needs correction)

- [ ] **Step 1: Production build**

```bash
cd apps/studio && source "$HOME/.cargo/env" && pnpm native:build 2>&1 | tail -20
```

Expected: `Finished` + a bundle at `src-tauri/target/release/bundle/macos/Uniqent Studio.app` (and a .dmg). Record the .app size — the spec target is ≤ ~15MB; report the actual number.

- [ ] **Step 2: Clippy gate**

```bash
cd apps/studio/src-tauri && cargo clippy -- -D warnings
```

Expected: clean. Fix anything it flags.

- [ ] **Step 3: Write the native dev docs**

Add to `apps/studio/README.md`:

```markdown
## Native app (Tauri)

Prereqs: Rust (`rustup`), Xcode CLT.

- `pnpm --filter @uniqent/studio native:dev` — dev app (Vite HMR + Rust backend)
- `pnpm --filter @uniqent/studio native:build` — Studio.app + DMG (src-tauri/target/release/bundle)
- `pnpm --filter @uniqent/studio fixtures` — regenerate golden fixtures after changing the TS session
  (cargo tests in src-tauri assert the Rust session matches them)

Phase 1 scope: brain meta/persona/readme/targets/avatar editing natively; memory, MCP/skill hubs,
export and install land in later phases (the UI shows "not yet available in the native app").
```

- [ ] **Step 4: Full gate, one last time**

```bash
pnpm --filter @uniqent/studio typecheck && pnpm --filter @uniqent/studio test && cd apps/studio/src-tauri && cargo test && cargo clippy -- -D warnings
```

Expected: everything green.

- [ ] **Step 5: Human smoke test (report, don't skip)**

`pnpm --filter @uniqent/studio native:dev` — the window opens with the Studio UI; edit name/description, persona, readme; add a target; reset. Each action round-trips through Rust (state updates). Later-phase panels show the coming-soon error, not a crash. Note anything broken in the report.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/README.md apps/studio/src-tauri
git commit -m "docs(studio): native dev workflow; phase-1 wiring verified"
```

---

## Notes for the implementer

- **Rust install is a system prerequisite** (Task 1 Step 1) — if denied, everything is blocked; report immediately.
- **First cargo build is slow** (crates.io downloads + WKWebView glue); later builds are incremental.
- **The fixtures are the law**: when `assert_eq!` fails, the printed JSON diff tells you exactly which manifest/validation field the Rust port got wrong. Read `packages/core/src/validate.ts` and `packages/spec/src` rather than guessing.
- **Do not modify SPA components** — only `web/src/api.ts` (+ test). If a component breaks under the shim, the shim is wrong, not the component.
- Prettier runs in CI on all files: run `pnpm format` before the final commit of each task.
