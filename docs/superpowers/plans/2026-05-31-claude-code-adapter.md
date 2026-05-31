# Claude Code Adapter + Install Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Install an exported `.uniqent` into Claude Code via an adapter + a thin CLI.

**Architecture:** `adapter-sdk` (Adapter interface + conformance) → `adapter-claude-code`
(detect/plan/apply/export) → `cli` (`inspect`, `install`). See
`docs/superpowers/specs/2026-05-31-claude-code-adapter-design.md`.

**Tech Stack:** TypeScript ESM, `@uniqent/core`, `node:fs`, vitest. No new runtime deps.

> **Commit policy:** Stage as you go; land all of M4 as ONE squashed feature commit. The sandbox
> install verification must pass before the commit.

---

### Task 1: `packages/adapter-sdk`

- `package.json` (`@uniqent/adapter-sdk`, dep `@uniqent/core` workspace; dev vitest), `tsconfig.json`, `vitest.config.ts`.
- `src/types.ts`: `Adapter`, `InstallOptions`, `InstallPlan`, `PlanWrite`, `Lossiness`, `ResolvedCredentials`, `InstallResult`, `DetectResult`.
- `src/conformance.ts`: `runConformance(adapter, bundle, root)` → plan; apply twice with dummy creds (`test-<ref>`); assert idempotent (compare file tree), no secret prefixes in written files (reuse a small prefix list), lossiness covers channels/tasks/tools/memory present in bundle. Returns `{ ok, checks }`.
- `src/index.ts` re-exports.
- Test `test/conformance.test.ts`: a stub adapter that writes a file → conformance passes; a non-idempotent stub → fails.

### Task 2: `packages/adapter-claude-code`

- `package.json` (`@uniqent/adapter-claude-code`, deps `@uniqent/adapter-sdk`, `@uniqent/core`, `@uniqent/spec`; dev vitest), `tsconfig.json`, `vitest.config.ts`.
- `src/mcp.ts`: `toClaudeMcpEntry(server, resolved)` → Claude Code `.mcp.json` server object (stdio/http/sse + credential injection via core `resolvePlaceholders` + auth headers).
- `src/index.ts`: `export const claudeCodeAdapter: Adapter`.
  - `detect({root})`: `{ present: true, configRoot: join(root,'.claude') }` (+ version undefined).
  - `plan(bundle,{root})`: compute writes (skills → `.claude/skills/...`, persona → `AGENTS.md`, mcp → `.mcp.json`), `mcpRegistrations`, `requiresCredentials` (creds consumed by mcp), `lossiness` (channels/tasks/tools dropped, memory transformed), `channelRegistrations: []`.
  - `apply(bundle,plan,resolved,{root})`: write skill files; write `AGENTS.md` (persona+policies+memory); merge `.mcp.json`; return written + notes.
  - `export({root})`: read `.claude/skills/*` + `AGENTS.md` + `.mcp.json` → a `Bundle` (synth manifest via builder is avoided; build files + a minimal manifest by hand). Best-effort.
- Tests `test/adapter.test.ts`: plan + apply into tmp; assertions per spec; idempotent; no secrets; conformance passes.

### Task 3: `packages/cli`

- `package.json` (`uniqent` bin; deps `@uniqent/core`, `@uniqent/adapter-claude-code`, `@uniqent/adapter-sdk`; dev vitest), `tsconfig.json`, `vitest.config.ts`.
- `src/run.ts`: `run(argv, io)` → dispatch `inspect` / `install`. `io` = `{ log, error, prompt? }` injectable for tests. Arg parsing hand-rolled. Credentials from `--cred ref=val`, env `UNIQENT_CRED_<REF>`, else prompt (skipped in tests via provided creds).
- `src/bin.ts`: `#!/usr/bin/env node` → `run(process.argv.slice(2), realIo)`.
- Tests `test/run.test.ts`: pack a bundle to a tmp file; `run(['inspect', file])` logs summary; `run(['install', file, '--target','claude-code','--root',tmp,'--cred','github_pat=ghp_test'])` installs; assert files on disk.

### Task 4: Integration verify + gate + status + squash commit

- A test (or script) that takes a Studio-style bundle, packs, installs into a tmp `.claude/`, asserts skills/AGENTS.md/.mcp.json + injected cred + no secrets + idempotent.
- `pnpm build && typecheck && lint && test && format:check` green.
- Update `CLAUDE.md` status → M4 (Claude Code install) done.
- Squash commit `feat: M4 Claude Code adapter + install`.

## Self-review

Covers spec: adapter contract + conformance (T1), Claude Code translation (T2), CLI install/inspect (T3), integration proof + gate (T4). No placeholders; types shared from core.
