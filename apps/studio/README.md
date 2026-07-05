# Uniqent Studio

The local-first visual builder for portable AI agents.

## Native app (Tauri)

Prereqs: Rust (`rustup`), Xcode CLT.

- `pnpm --filter @uniqent/studio native:dev` — dev app (Vite HMR + Rust backend)
- `pnpm --filter @uniqent/studio native:build` — Studio.app + DMG (src-tauri/target/release/bundle)
- `pnpm --filter @uniqent/studio fixtures` — regenerate golden fixtures after changing the TS session
  (cargo tests in src-tauri assert the Rust session matches them)

Phase 1 scope: brain meta/persona/readme/targets/avatar editing natively; export (signed or
unsigned) is now live — `api.export(sign)` invokes the Rust core pack/sign pipeline, producing a
`.uniqent` bundle that the TS core verifier (`scripts/verify-file.ts`) validates. Memory, MCP/skill
hubs, and install land in later phases (the UI shows "not yet available in the native app").
