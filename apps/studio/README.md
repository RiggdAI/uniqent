# Uniqent Studio

The local-first visual builder for portable AI agents.

## Native app (Tauri)

Prereqs: Rust (`rustup`), Xcode CLT.

- `pnpm --filter @uniqent/studio native:dev` — dev app (Vite HMR + Rust backend)
- `pnpm --filter @uniqent/studio native:build` — Studio.app + DMG (src-tauri/target/release/bundle)
- `pnpm --filter @uniqent/studio native:build:universal` — universal (arm64 + x86_64) macOS build
- `pnpm --filter @uniqent/studio fixtures` — regenerate `catalog*.json` from the builder catalogs
  (Rust embeds them); `fixtures/state-*.json` are hand-maintained frozen Rust goldens (no
  generator: edit them by hand, and review the diff, only when session state intentionally changes)

Native scope (Phase 4): Studio is native-only (strict CSP, minimal capabilities, no server or localhost
port) and covers content building, hubs, vault, publish, install-to-agent (Claude Code, Hermes,
OpenClaw; reviewed plan + lossiness before Rust writes), capture of an existing agent, Open/Save
`.uniqent` and drag-and-drop. The adapters' pure cores run in the webview and are shared with the CLI;
Rust does all file I/O and only reads/writes folders you picked, dropped, or the default framework homes.
