# Studio Native Phase 3a (Content State + Pure Ports) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full content-building parity in the native Studio app without I/O: MCP/skills/channels/tasks/memory/profile session state in Rust, plus faithful ports of `normalizeMcpConfig` and `parseMemoryMarkdown`/`memoryGraph` — so a complete brain (not just meta/persona) can be built and exported natively. (Phase 3b adds the network/FS features: hub searches, registry publish, vault import.)

**Architecture:** Same fixture-law pattern as Phases 1–2: the TS implementation is the reference; TS-emitted golden fixtures are committed; `cargo test` asserts Rust equality; TS drift tests re-derive from the live TS code so neither side can drift silently. The Rust session grows content collections (mcps/skills/channels/tasks/facts/profile) that feed three places consistently: `state()` (manifest.components counts + validation), the export bundle (file mapping per `Brain.toBundle`), and the fixtures.

**Tech Stack:** Existing Rust deps (serde_json preserve_order, regex); TS: tsx emit scripts, Vitest.

## Global Constraints

- Repo `uniqent`, branch `feat/studio-native`. Commit there. Cargo: `source "$HOME/.cargo/env"` first.
- **TS references (read, never guess):** `packages/builder/src/brain.ts` (content state, manifest derivation, `toBundle` file mapping at line ~249), `apps/studio/src/server/session.ts` (the session methods being ported — exact semantics incl. dedup/normalize-on-add and return values), `packages/builder/src/mcp/normalize.ts` (176 lines), `packages/builder/src/memory/parse.ts` (164 lines: `parseMemoryMarkdown` + `memoryGraph`), `packages/core/src/validate.ts` (rules that become reachable once components exist).
- **Fixture law:** every new Rust behavior is pinned by a TS-emitted fixture + a TS drift test that re-derives it from the live TS code (the Phase-2 pattern — `buildFixtureBundle`-style shared helpers exported from emit scripts).
- `toBundle` file mapping (verified from brain.ts): facts → `memory/facts.jsonl` (one JSON per line + trailing `\n`), profile → `memory/profile.json` (pretty 2-space), mcp → `mcp/servers.json` as `{"servers": […]}` pretty, channels → `channels/channels.json` as `{"channels": […]}` pretty, each skill → `skills/<name>/SKILL.md` (+ extra files), each task → `tasks/<id>.json` pretty, manifest last. Empty collections write NO file.
- Command names for the new Tauri commands (snake_case): `add_mcp_catalog`, `add_custom_mcp`, `import_mcp_servers`, `paste_mcp_preview`, `remove_mcp`, `add_skill_catalog`, `add_custom_skill`, `remove_skill`, `add_channel_catalog`, `remove_channel`, `add_task`, `remove_task`, `add_memory`, `import_memory`, `preview_memory`, `memory_graph`, `set_profile`, `get_profile`. All mutators return full `state()`; previews/graph return their own values (mirror the TS ApiResponse shapes in `api.ts`).
- Only `web/src/api.ts` (+ `api.test.ts`) may change in web/src.
- Gates per task: `cargo test` + `cargo clippy --all-targets -- -D warnings`; `pnpm --filter @uniqent/studio test` + typecheck; `pnpm format` before each commit.
- Commit after every task. DRY, YAGNI, TDD.

---

## File Structure

- `apps/studio/scripts/emit-fixtures.ts` (modify) — content-rich canonical script → `fixtures/state-content.json`.
- `apps/studio/scripts/emit-port-fixtures.ts` (create) — normalize + memory-parse/graph case fixtures.
- `apps/studio/fixtures/{state-content.json, ports/normalize-cases.json, ports/memory-cases.json}` (generated).
- `apps/studio/test/fixtures.test.ts` (modify) + `apps/studio/test/port-fixtures.test.ts` (create) — drift guards.
- `apps/studio/src-tauri/src/session.rs` (modify) — content collections + mutators + manifest/validation growth + bundle assembly.
- `apps/studio/src-tauri/src/ports/mod.rs`, `ports/mcp_normalize.rs`, `ports/memory.rs` (create) — pure-function ports.
- `apps/studio/src-tauri/src/commands.rs`, `main.rs` (modify) — new commands.
- `apps/studio/src-tauri/tests/{content_test.rs, ports_test.rs}` (create) — fixture equality.
- `apps/studio/web/src/api.ts` + `api.test.ts` (modify) — the ~18 methods go live.

---

## Task 1: Content-state golden fixtures

**Files:**

- Modify: `apps/studio/scripts/emit-fixtures.ts`; Create: `apps/studio/fixtures/state-content.json`; Modify: `apps/studio/test/fixtures.test.ts`

**Interfaces:**

- Produces THE canonical content script (used verbatim in TS here and Rust in Task 2). Applied to a fresh `StudioSession` AFTER the existing canonical meta mutations (`setMeta({name:'fixture-brain',…1.2.3})`, targets, persona, readme):
  1. `addMcpFromCatalog('<first id from fixtures/catalog.json mcp list>')`
  2. `addCustomMcp({ id: 'custom-api', name: 'Custom API', transport: 'http', url: 'https://api.example.com/mcp' })` (adapt fields to what session.addCustomMcp actually accepts — read it; record the exact object used as THE canonical literal)
  3. `addCustomSkill('fixture-skill', '# fixture-skill\n\nDoes fixture things.\n')`
  4. `addChannelFromCatalog('<first id from catalog channels>')`
  5. `addTask({ name: 'Nightly digest', schedule: '0 9 * * *', instructions: 'Summarize.' })` (adapt to addTask's real signature; record the canonical literal + note the generated task id handling — if ids are random/sequential, read session.ts; if random, the fixture pins whatever is deterministic and the id field is normalized — STOP and report if ids are nondeterministic and unnormalizable)
  6. `addFact({ text: 'Fixture prefers [[Rust]] #perf', kind: 'preference', importance: 0.8 })` and a second plain fact `addFact({ text: 'plain fact' })` (adapt to addFact's real signature)
  7. `setProfile({ name: 'Fixture User', role: 'Tester' })`
  8. One removal to pin remove-semantics: `removeMcp('custom-api')` — then re-add it (`addCustomMcp` same literal) so the final state has both MCPs.
- Emit `state-content.json` = `session.state()` after the script. The emit script exports `applyContentScript(session)` so the drift test and future scripts share it.

- [ ] **Step 1:** Read `apps/studio/src/server/session.ts` methods (addMcpFromCatalog/addCustomMcp/addCustomSkill/addChannelFromCatalog/addTask/addFact/setProfile/removeMcp) and finalize the canonical literals (exact objects). If task/fact ids are nondeterministic (e.g. `crypto.randomUUID`), check how they surface in `state()`; if they appear and can't be made deterministic, report BLOCKED with the details (the controller will decide a normalization).
- [ ] **Step 2:** Extend `emit-fixtures.ts` with `applyContentScript` + the new emission; run `pnpm --filter @uniqent/studio fixtures`; inspect `state-content.json` (components counts? validation? new manifest fields?). Record the shape notes in your report.
- [ ] **Step 3:** Add the drift test to `fixtures.test.ts` (fresh session → canonical meta script → `applyContentScript` → toEqual `state-content.json`).
- [ ] **Step 4:** Gates + commit: `feat(studio): content-state golden fixture (mcp/skill/channel/task/memory/profile)`.

---

## Task 2: Rust session content state (fixture-driven)

**Files:**

- Modify: `apps/studio/src-tauri/src/session.rs`
- Test: `apps/studio/src-tauri/tests/content_test.rs` (create)

**Interfaces:**

- Consumes: `fixtures/state-content.json` (Task 1) + the canonical content script literals.
- Produces on `Session`: `add_mcp_catalog(id) -> Result<(), String>` (unknown id → Err), `add_custom_mcp(Value) -> Result<(), String>`, `remove_mcp(id)`, `add_skill_catalog(name) -> Result<(), String>`, `add_custom_skill(name, skill_md)`, `remove_skill(name)`, `add_channel_catalog(id) -> Result<(), String>`, `remove_channel(id)`, `add_task(Value) -> Result<(), String>`, `remove_task(id)`, `add_fact(Value) -> Result<(), String>`, `set_profile(Value)`, `get_profile() -> Value` — semantics mirroring the TS session (dedup rules, normalization on add, error messages: read session.ts; catalog lookups read the embedded `catalog.json`).
- `state()` grows: `manifest.components` reflects the collections (skills list, mcp list/count, memory counts, tasks, channels, hasProfile — mirror `Brain.buildManifest`); validation rules that become reachable (e.g. components.identity↔persona already done; skills declared↔present is trivially consistent here) mirror TS.
- The export `build_bundle` writes the component files per the toBundle mapping in Global Constraints.

- [ ] **Step 1:** Write `content_test.rs`: fresh Session → the canonical meta mutations → the canonical content script (same literals as Task 1, translated) → `assert_eq!(s.state(), fixture("state-content.json"))`. Plus unit tests: `add_mcp_catalog("nonexistent")` → Err; `remove_skill` then state has no skill; re-add dedup behavior per TS. RED.
- [ ] **Step 2:** Implement the collections + mutators + manifest/validation growth in `session.rs` (split a `session/content.rs` submodule if session.rs exceeds ~600 lines). Iterate on the state fixture diff to GREEN.
- [ ] **Step 3:** Extend `build_bundle` with the component file mapping; extend the existing export test: a session with content exports a bundle whose files include `mcp/servers.json`, `skills/fixture-skill/SKILL.md`, `memory/facts.jsonl`, `memory/profile.json`, `channels/channels.json`, a `tasks/<id>.json` — and the exchange artifact test now uses a CONTENT-RICH session; re-run the TS verify (`pnpm exec tsx scripts/verify-file.ts …`) and paste the output.
- [ ] **Step 4:** Gates + commit: `feat(studio): Rust session content state — full brain building natively`.

---

## Task 3: `normalizeMcpConfig` port

**Files:**

- Create: `apps/studio/scripts/emit-port-fixtures.ts` (normalize section), `apps/studio/fixtures/ports/normalize-cases.json`, `apps/studio/test/port-fixtures.test.ts` (normalize section)
- Create: `apps/studio/src-tauri/src/ports/mod.rs`, `ports/mcp_normalize.rs`; modify `lib.rs`
- Test: `apps/studio/src-tauri/tests/ports_test.rs` (create)

**Interfaces:**

- Produces: `normalize_mcp_config(text: &str) -> Value` returning the same `NormalizeResult` JSON the TS `normalizeMcpConfig` returns (servers, warnings, errors — read normalize.ts for the exact shape).
- Fixture format: `normalize-cases.json` = `[{ name, input, expected }]` where `expected = normalizeMcpConfig(input)` from TS. Cases (author them in the emit script; ~8): a Claude-Desktop-style `{"mcpServers": {...}}` paste; a bare single server object; an array of servers; a `servers:` wrapped object; one with env secrets (placeholder handling); malformed JSON; empty string; a server missing required fields (warnings path). Mine `packages/builder/test/mcp-normalize.test.ts` for its exact cases and reuse them.

- [ ] **Step 1:** Emit script + drift test (drift test maps over cases re-running the live TS `normalizeMcpConfig` and comparing to the fixture). Generate + commit fixtures.
- [ ] **Step 2:** Rust test: map over `normalize-cases.json`, `assert_eq!(normalize_mcp_config(&case.input), case.expected)` per case with the case name in the panic message. RED.
- [ ] **Step 3:** Port normalize.ts faithfully (176 lines; keep function structure parallel). GREEN.
- [ ] **Step 4:** Wire session: `add_pasted_mcp(text)` / `paste_mcp_preview(text)` / `import_mcp_servers(servers)` per the TS session semantics (normalize → add valid servers → return counts/preview). Unit tests for each. Gates + commit: `feat(studio): normalizeMcpConfig port (fixture-verified)`.

---

## Task 4: `parseMemoryMarkdown` + `memoryGraph` port

**Files:**

- Modify: `apps/studio/scripts/emit-port-fixtures.ts` (+ memory section) → `fixtures/ports/memory-cases.json`; extend `test/port-fixtures.test.ts`
- Create: `apps/studio/src-tauri/src/ports/memory.rs`
- Test: extend `tests/ports_test.rs`

**Interfaces:**

- Produces: `parse_memory_markdown(text: &str) -> Value` (array of imported items) and `memory_graph(facts: &Value, episodic: &Value) -> Value` matching the TS signatures/shapes (read parse.ts — `memoryGraph`'s exact parameters come from how session.ts calls it at line ~299).
- Fixture: `memory-cases.json` = `[{ name, markdown, parsed, graph }]` where `parsed = parseMemoryMarkdown(markdown)` and `graph = memoryGraph(<parsed-as-facts>, [])` from TS. Cases (~6, mine `packages/builder/test/memory-parse.test.ts`): headings + bullets; `kind:` prefixes; `[[entity]]` links; `#tags`; blank/whitespace input; a mixed document.

- [ ] **Step 1:** Emit + drift test + commit fixtures.
- [ ] **Step 2:** Rust case-mapped tests RED → port parse.ts faithfully → GREEN.
- [ ] **Step 3:** Wire session methods: `import_memory` (markdown/items/text per the TS `/api/memory/import` body handling), `preview_memory(text) -> {items, graph}`, `memory_graph() -> MemoryGraph` from session facts. Unit tests. Gates + commit: `feat(studio): memory parse + graph port (fixture-verified)`.

---

## Task 5: Commands + shim swap + wrap-up

**Files:**

- Modify: `apps/studio/src-tauri/src/commands.rs`, `main.rs`; `apps/studio/web/src/api.ts`, `web/src/api.test.ts`; `apps/studio/README.md`

**Interfaces:**

- Consumes: everything above. Registers the command list from Global Constraints; api.ts swaps the corresponding methods from `soon()` to `invoke(...)` with arg mapping mirroring the TS routes (read each api.ts method: `addMcp(id)` → `invoke('add_mcp_catalog', { id })`, `pasteMcpPreview(text)` → `invoke('paste_mcp_preview', { text })`, etc.). Methods that stay `soon()`: hub searches, memory hub add/publish, vault preview/import, export-adjacent install (Phase 3b/4) — list them explicitly in the test.

- [ ] **Step 1:** api.test.ts: extend the invoke-routing test to cover a representative mutator of each family (mcp/skill/channel/task/memory/profile) + assert the REMAINING stub list is exactly the Phase 3b/4 set. RED → implement → GREEN.
- [ ] **Step 2:** Register all commands; `cargo test` all green; clippy.
- [ ] **Step 3:** README scope paragraph update (content building fully native; hubs/publish/vault + install still coming). Full gates. Commit: `feat(studio): content commands live in the native app`.
- [ ] **Step 4:** Human smoke test note for the report: build a brain WITH an MCP + skill + memory in the native app, export signed, `uniqent inspect` shows the components.

---

## Notes for the implementer

- **Fixture law**: never adjust a fixture to make Rust pass; fixtures are TS-emitted. If TS behavior is surprising (e.g. nondeterministic ids), STOP and report.
- **session.ts is the API-semantics reference** (what each endpoint accepts/returns); **brain.ts is the state-semantics reference** (dedup, manifest derivation, toBundle).
- Prettier + clippy before every commit; CI runs both suites.
