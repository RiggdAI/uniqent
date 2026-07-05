# Studio as a native app (Tauri + Rust backend)

**Date:** 2026-07-04
**Repo:** `uniqent` (monorepo) — branch `feat/studio-native`
**Status:** Approved design (umbrella spec; each phase gets its own plan)

## Problem

Uniqent Studio is "the local-first visual builder for portable AI agents," but it
is delivered as a browser tab: a React/Vite SPA (~3.4k lines) served by a local
Node HTTP server (~1k lines: `session`/`api`/`guard`) on `localhost:4173`. The
server does the real work through `@uniqent/core`, `@uniqent/builder`, and the
adapters. Consequences:

- No real app window, dock icon, native file dialogs, or drag-a-folder-in.
- The user must start a server and open a browser tab.
- `@uniqent/studio` is `private: true` — it has never been distributable at all.

## Decision

Rebuild Studio as a **native Tauri v2 app with a Rust backend** (approach C),
**native-only** (the localhost-server mode is deleted at parity), **macOS
first** (nothing that blocks Windows/Linux later). Goals: real native app,
optimized for performance, first-class local-directory access, and keep it
lite — no bundled runtimes.

### Alternatives considered

- **Tauri + Node sidecar** (full TS reuse, ~50–70MB, two processes) — rejected:
  bundles a JS runtime; not the performance ceiling the product wants.
- **Logic in the webview on Tauri FS APIs** — rejected: forces `node:fs` ports
  inside `core`/`builder`/adapters, which the CLI also depends on.
- **Electron** — rejected outright (heavy).

### The accepted trade-off (on record)

Brain logic will exist **twice**: TypeScript (`@uniqent/core` for the CLI and
registry) and Rust (for Studio). The guardrail is a **golden cross-implementation
fixture suite** (see Compatibility). Long-term option, out of scope: the CLI
adopts the Rust core via napi bindings, making Rust the single source of truth.

## Hard compatibility requirement

A Studio-packed `.uniqent` must be **byte-compatible** with the TS
implementation's expectations:

- `canonicalDigest` (SHA-256 over the canonical serialization) must produce the
  **identical hex** for the same bundle in Rust and TS.
- Signatures are **ed25519** (TS: `@noble/ed25519`; Rust: `ed25519-dalek`). The
  signed payload construction must match exactly so TS `verify()` accepts
  Rust-signed bundles and vice versa.
- The registry trust gate (`checkBundle`) and `uniqent install` must accept
  Studio exports with no special-casing.

**Enforcement:** a fixtures directory of sample bundles with committed expected
digests; CI runs both the TS test (existing packages) and the Rust test
(`cargo test`) against the same fixtures. Any divergence fails the build.

## Architecture

```
apps/studio/
├── web/            # existing SPA, reused (xyflow, tiptap, force-graph)
│   └── src/lib/api-client.ts   # NEW thin shim: invoke() instead of fetch('/api/…')
├── src-tauri/      # NEW Rust app
│   ├── src/session.rs   # in-memory brain draft (struct behind Tauri state Mutex)
│   ├── src/commands/…   # one Tauri command per today's endpoint
│   └── uniqent-core/    # Rust crate: pack/digest/sign/verify/validate/secret-scan
└── src/server/     # legacy Node server — DELETED at parity (end of Phase 4)
```

- The SPA is loaded from Tauri's asset protocol; all `/api/*` fetches are
  replaced by Tauri `invoke()` calls through one `api-client` module (single
  point of change; the rest of the SPA is untouched).
- Session state lives in a Rust struct behind Tauri managed state.
- Local-directory access via Tauri `dialog`/`fs` plugins with explicit scopes
  (macOS-sandbox-friendly); picked paths flow into commands as arguments.
- Registry auth: Studio reads the CLI's `~/.uniqent/credentials.json`
  (0600, per-registry tokens) — device-login/`uniqent login` works for Studio
  for free.

### Performance goals (concrete)

- Cold launch < 1 s to interactive.
- App bundle ≤ ~15 MB (no Node/Bun/Chromium; WKWebView).
- Export (pack+sign) of a typical brain < 200 ms.

## Phases (each its own spec→plan→build cycle)

### Phase 1 — Tauri shell (macOS)

Tauri v2 app in `apps/studio` hosting the existing SPA behind the `api-client`
shim. Rust session + the pure-state commands (`state`, `meta`, `persona`,
`readme`, `targets`, `reset`, `catalog` as static data, `avatar`). `export` /
`install` visibly stubbed ("coming soon"). **Deliverable: a running native
Studio.app where you can build a brain's content.**

### Phase 2 — Rust core engine

`uniqent-core` Rust crate: `pack`/`unpack`, `canonicalDigest`, ed25519
`sign`/`verify`, `validateBundle`, secret-scan — plus the golden fixture suite
wired into CI. `export` goes live. **Deliverable: native export → a `.uniqent`
the CLI installs and the registry accepts.**

### Phase 3 — Builder features

Catalogs, MCP/skill hub search (HTTP), memory markdown parser + memory graph,
vault import, `normalizeMcpConfig`, publish-to-registry (Bearer token from the
shared credentials file). **Deliverable: full builder parity with today's
browser Studio.**

### Phase 4 — Adapters + ship

Install-to-agent (claude-code/hermes/openclaw file-writers in Rust), native
file dialogs + drag-and-drop everywhere, delete `src/server`, codesign +
notarize, DMG artifact, auto-updater. **Deliverable: distributable
Studio.app; Node server gone.**

## Error handling

- Command errors surface as typed `Result<_, String>` → the SPA's existing
  error UI (the api-client maps rejected invokes like failed fetches today).
- Missing credentials on publish → actionable "run `uniqent login` or sign in"
  message, same contract as the CLI.
- FS access outside granted scopes fails closed with a clear dialog.

## Testing

- Rust: unit tests per module (`cargo test`); the cross-impl fixture suite is
  the release gate for Phase 2+.
- Web: existing Vitest suites keep running; the `api-client` shim gets a unit
  test with a mocked `invoke`.
- Per phase: `pnpm typecheck` + `cargo clippy -D warnings` clean.
- Human-gated per phase: launch the .app and exercise the deliverable.

## Out of scope

- Windows/Linux builds (design must not block them; ship after macOS).
- napi bindings to make the CLI use the Rust core.
- Any registry/server-side changes.
- Feature additions beyond parity with today's Studio.
