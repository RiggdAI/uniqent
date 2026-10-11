# Uniqent Studio

The local-first visual builder for portable AI agents.

## Native app (Tauri)

Prereqs: Rust (`rustup`), Xcode CLT.

- `pnpm --filter @uniqent/studio native:dev` — dev app (Vite HMR + Rust backend)
- `pnpm --filter @uniqent/studio native:build` — Studio.app + DMG (src-tauri/target/release/bundle)
- `pnpm --filter @uniqent/studio fixtures` — regenerate `catalog*.json` from the builder catalogs
  (Rust embeds them); `state-*.json` are frozen Rust goldens

Native scope (through Phase 3b): content building is fully native — MCP servers, skills, channels,
tasks, memory and profile invoke the Rust backend directly, and export runs the Rust core pack/sign
pipeline (the TS core verifier `scripts/verify-file.ts` validates the result). Hubs (MCP/skill/memory
search & add), publish (using the `uniqent login` token), skill-from-URL and vault import run the same
pure TypeScript as the CLI (`@uniqent/builder/hubs`, `@uniqent/builder/memory`) over Tauri's
plugin-http (https only); vaults are read by Rust only from a folder picked in the native dialog.
Install-to-agent and capture arrive in Phase 4 (use `uniqent install` meanwhile).
