# Studio native — finish and ship (latest deps, hybrid logic, capture)

**Date:** 2026-09-28
**Repo:** `uniqent` (monorepo) — branch `feat/studio-native-ship` (based on `fix/audit-hardening`)
**Status:** Approved design. Amends the umbrella spec
[`2026-07-04-studio-native-design.md`](2026-07-04-studio-native-design.md) for Phases 3b and 4.
Three sub-projects, built in order, each with its own plan, gates and PR.

## Why

Uniqent is the builder + packager + translator + installer for portable agent brains; the
headline use case is institutional-knowledge continuity (keep a departing person's agent brain,
hand it to the next hire). Studio is the product's face, so Studio.app must be self-contained
(no Node, no terminal) and uphold every non-negotiable principle (secrets never travel, raw-file
install, translation not copy, trust first-class, no silent loss) without a local server.

Phases 1–3a are done: content building and signed export run natively in Rust. Missing: hubs,
publish, vault import, skill-from-URL, install-to-agent, capture, native file handling, deleting
the Node server, and a distributable DMG. Dependencies are also behind (Tauri 2.11, several
majors).

## Decision: hybrid logic (amends the umbrella spec)

The umbrella spec planned to port hubs, vault, publish and all three install adapters to Rust.
Since the 2026-09-27 audit the adapters are ~3k lines, fast-changing and security-critical, and the
Hermes adapter merges `config.yaml` preserving comments via the npm `yaml` Document API — no Rust
YAML library can reproduce that byte-for-byte. A Rust port would double every future adapter fix.

**New split:** Rust owns all file I/O, HTTP, path confinement, file modes, crypto and the session.
Pure TypeScript modules — adapter `translate`/`capture`, hub sources + mappers, the vault parser —
are bundled into the web UI (WKWebView JS, no Node runtime) and shared verbatim with the CLI.
The umbrella spec's rejection of "logic in the webview" was about `node:fs` inside
core/builder/adapters; here the webview never touches the filesystem. Existing Rust ports
(core pack/digest/sign/verify/validate/secret-scan, memory parser, MCP normalize) stay, guarded by
the golden fixtures.

## Sub-project 1 — Dependency upgrade

Rule: every dependency to the newest version the rest of the toolchain supports; where "latest"
is impossible, pin the newest compatible version and record why.

| Area                                      | Target                                                                                                | Notes                                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript                                | latest 6.0.x                                                                                          | 7.x unsupported by typescript-eslint (`<6.1.0` peer)                                                                                        |
| `@types/node`                             | latest 22.x                                                                                           | tracks the `engines.node >=20` floor, not the newest Node                                                                                   |
| ESLint + `@eslint/js` / typescript-eslint | 10.x / latest 8.x                                                                                     | flat config already used                                                                                                                    |
| Vitest                                    | 5.x                                                                                                   |                                                                                                                                             |
| Vite / `@vitejs/plugin-react`             | 8.x / 6.x                                                                                             | Rolldown-based Vite                                                                                                                         |
| Tailwind                                  | 4.x (+ `@tailwindcss/vite`, tailwind-merge 3, `tw-animate-css` replacing `tailwindcss-animate`)       | CSS-first config via the official upgrade tool; drop postcss/autoprefixer if unused                                                         |
| Tiptap                                    | 3.x                                                                                                   | replace `tiptap-markdown` with Tiptap's official markdown extension if the community one lacks v3 support                                   |
| Zod                                       | 4.x                                                                                                   | `zod-to-json-schema` → native `z.toJSONSchema`; generated JSON Schema + `docs/SPEC.md` must stay semantically identical — any diff reviewed |
| `@noble/ed25519`                          | 3.x                                                                                                   | core signing API changes                                                                                                                    |
| All others                                | latest                                                                                                | React, xyflow, radix, lucide, force-graph, prettier, tsx, tar-stream, yaml, json5, pnpm (`packageManager`)                                  |
| Rust                                      | tauri 2.12 / tauri-build 2.7, ed25519-dalek 3, rand 0.10, sha2 0.11, base64 0.23, then `cargo update` |                                                                                                                                             |

**Acceptance:** build, typecheck, lint, format, every Vitest suite, `cargo test` and
`cargo clippy --all-targets -- -D warnings` green; **golden fixtures unchanged** (same digests and
signatures across TS and Rust); Studio web and `tauri build` both run; the CLI pack-smoke
(`try` into all three targets from packed tarballs) passes. One commit per logical group
(toolchain, UI stack, zod/spec, crypto, Rust).

## Sub-project 2 — Hybrid foundation + Phase 3b

- **Browser-safe entry points** (pure subpath exports, no `node:*` in their module graph):
  `@uniqent/core/pure` (Bundle, validate, secret-scan, digest), `@uniqent/builder/hubs`,
  `@uniqent/builder/memory`. An ESLint rule forbids `node:*` imports in those files. The `.`
  entry points are unchanged.
- **Injected fetch:** hub sources receive the fetch function explicitly (no global). The CLI passes
  Node's `fetch`; Studio passes `@tauri-apps/plugin-http`'s `fetch`, whose capability scope allows
  only the known hub/registry hosts over https.
- **Wiring** (each replaces a "not yet available in the native app" stub):

| Feature                       | Rust                                                                                                           | Pure TS (web)                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| MCP/skill hub search + add    | HTTP plugin; add → Rust session                                                                                | `searchMcpHubs` / `searchSkillHubs` + mappers |
| Hub index list                | stored in the Rust session                                                                                     | —                                             |
| Skill from URL                | HTTP plugin fetch of `SKILL.md`                                                                                | frontmatter name parsing                      |
| Vault preview/import          | native folder picker; walk → `{path→text}` with `.obsidian` skipped, symlinks rejected, size + file-count caps | `importVault(files)` → Rust session           |
| Memory hub search/add/publish | publish reads the token from `~/.uniqent/credentials.json` (written by `uniqent login`); UI field overrides    | memory-hub client                             |

- **Errors:** Rust command errors and HTTP failures surface in the existing inline error UI;
  per-hub failures stay per-source. No generic stubs remain.
- **Tests:** existing hub/vault Vitest suites run against the pure modules; Rust tests for the vault
  walk (caps, skips, symlinks); a browser-bundle test proving the pure entry points have no Node
  imports; an end-to-end run in the native dev app.

## Sub-project 3 — Phase 4: install, capture, native, ship

1. **Adapter split.** Each adapter exposes pure
   `inputs(bundle, ctx)` (files it must read) and
   `translate(bundle, existing, ctx) → { plan, writes: { path, bytes, mode }[], notes }`, plus pure
   `captureInputs(ctx)` / `capture(files, ctx) → Bundle` for export. Node `apply()`/`export()` become
   read → pure → write wrappers, so CLI and Studio share one implementation.
2. **Rust I/O commands.** `read_inputs(root, paths)` and `write_outputs(root, writes)`: every path
   confined to the root (reject absolute, `..`, symlinks), atomic temp-file + rename, mode applied
   (0600 for secret-bearing files), idempotent. Rust only accepts roots the user picked in a native
   dialog or the known framework homes (`~/.hermes`/`$HERMES_HOME`, `~/.openclaw`/`$OPENCLAW_STATE_DIR`,
   a picked project dir for Claude Code). Plan, dry-run, lossiness and credential prompts are shown
   before anything is written; credential values are never logged.
3. **Capture (departing-colleague flow).** Pick framework + folder → Rust reads → pure `capture` →
   loaded into the Rust session and opened on the canvas; personal/episodic memory scrubbed by
   default. The same `load_bundle` command gives **Open .uniqent** (Save = Export).
4. **Native feel.** Native dialogs everywhere; target auto-detect (ambiguity presented as a
   choice); drag a `.uniqent` onto the window to open it, a folder to import as vault or capture.
5. **Delete the Node server.** `apps/studio/src/server`, the `start` script, the guard and the
   fetch branch of `web/src/api.ts` go; every call is `invoke()` (or the HTTP plugin). No
   localhost port remains.
6. **Security.** Strict CSP (currently `null`); minimal capabilities (dialog, scoped http); no
   general fs plugin.
7. **Ship.** GitHub Actions on tag `studio-v*`: macOS runner, `tauri build` universal binary
   (Apple Silicon + Intel), DMG attached to a GitHub Release. Codesign, notarization and the
   updater are wired but skipped unless their secrets exist (unsigned DMG for now; users
   right-click → Open on first launch). Fails if the app bundle exceeds ~15 MB.
8. **Tests.** Adapter Vitest suites target `translate`/`capture`; Rust tests for confinement,
   modes, atomic writes, symlink rejection; an end-to-end check that installing the same bundle via
   Studio and via the CLI produces **byte-identical trees** for all three targets; a capture
   round-trip; a human-launched `.app` at each sub-project's end.

## Performance goals (unchanged)

Cold launch < 1 s to interactive; app bundle ≤ ~15 MB; export of a typical brain < 200 ms.

## Out of scope

Windows/Linux builds (must not be blocked); signing/notarization/updater credentials; hosted
registry changes; napi bindings; persistence beyond Open/Save `.uniqent`; new features beyond
parity plus capture.
