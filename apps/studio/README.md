# Uniqent Studio

The local-first visual builder for portable AI agents.

## Native app (Tauri)

Prereqs: Rust (`rustup`), Xcode CLT.

- `pnpm --filter @uniqent/studio native:dev` — dev app (Vite HMR + Rust backend)
- `pnpm --filter @uniqent/studio native:build` — Studio.app + DMG (src-tauri/target/release/bundle)
- `pnpm --filter @uniqent/studio fixtures` — regenerate golden fixtures after changing the TS session
  (cargo tests in src-tauri assert the Rust session matches them)

Phase 3a scope: content building is now fully native — MCP servers (catalog, custom, import, paste
preview, remove), skills (catalog, custom, remove), channels (catalog, remove), tasks (add, remove),
memory (add, import, preview, graph), and profile (get, set) all invoke the Rust backend directly.
Export (signed or unsigned) invokes the Rust core pack/sign pipeline, producing a `.uniqent` bundle
that the TS core verifier (`scripts/verify-file.ts`) validates. Hubs (MCP/skill/memory hub search &
add), publish, vault preview/import, and install are still coming in Phase 3b/4 (the UI shows
"not yet available in the native app" for those).
