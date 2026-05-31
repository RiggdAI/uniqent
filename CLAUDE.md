# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Uniqent is

Uniqent is an **open standard + toolchain for portable AI agents**. A user packages a
complete agent — persona/"brain", memory, skills, MCP servers, tools, automations, channels,
and runtime config — into a single signed `.uniqent` bundle (a gzipped tar). Anyone can then
**install that bundle in one click into the agent framework they run** (OpenClaw, Hermes,
Claude Code, …). A per-framework **adapter** transpiles the canonical bundle into that
framework's native layout. (n8n's export/import UX is the inspiration — we are NOT building
anything n8n-related; we package whole agents, not workflows.)

Open source: the spec is **CC0** (`LICENSE-SPEC`), the code is **Apache-2.0** (`LICENSE`).

## Non-negotiable principles (these OVERRIDE convenience)

1. **Secrets never travel in a bundle.** Bundles declare credential _requirements_; the
   installer resolves real secrets locally into the target framework's own credential store.
2. **Bundles install from a raw file or URL** with zero dependency on a hosted registry. The
   registry is optional convenience, never required.
3. **Install is a translation, not a copy.** One canonical format → per-adapter native output.
4. **Trust is first-class.** Signing, a permission manifest, and a sandboxed dry-run ship in v1.
5. **Lossy is acceptable, silent loss is not.** When a target can't hold something (e.g. memory
   limits), truncate/transform AND report exactly what changed in the plan's `lossiness`.

A hard, **fail-closed `scanForSecrets()` gate** runs on pack/validate/sign — any likely secret
value (entropy + known prefixes like `sk-`, `ghp_`, `xoxb-`) anywhere in a bundle fails the op.

## Source-of-truth files

- **`packages/spec`** is the source of truth for the bundle format (zod schema → generated JSON
  Schema → `docs/SPEC.md`). Change the schema there; never hand-edit generated artifacts.
- **`docs/BUILD_PLAN.md`** is the full engineering spec and milestone plan. Read it before any
  substantial work. Build milestone by milestone (M0→M6); stop at each acceptance gate and
  report results before continuing. Open a PR per milestone.

## Repo conventions

- TypeScript, Node 20+, **ESM only**. pnpm workspaces monorepo (`packages/*`).
- Validation with **zod**; JSON Schema generated via `zod-to-json-schema`.
- Tests with **vitest**. Adapters additionally ship round-trip conformance tests.
- Conventional commits. Keep PRs small and milestone-scoped. Keep the CLI thin — logic lives
  in core packages, not in command handlers.
- License header expectations: code = Apache-2.0, spec text/schema = CC0.

## Commands

```bash
pnpm install                       # install workspace deps
pnpm build                         # tsc build all packages (pnpm -r build)
pnpm test                          # run all package tests (vitest)
pnpm typecheck                     # type-only check across packages
pnpm lint                          # eslint
pnpm format                        # prettier --write

# Single package / single test:
pnpm --filter @uniqent/spec test   # one package's tests
pnpm vitest run packages/spec/test/manifest.test.ts        # one file
pnpm vitest run packages/spec/test/manifest.test.ts -t "rejects embedded secret"  # one test by name

# Regenerate JSON Schema + SPEC.md from the zod schema (run after editing packages/spec):
pnpm --filter @uniqent/spec gen
```

## Architecture (big picture)

- **`packages/spec`** — the canonical `.uniqent` schema. Everything else depends on it.
- **`packages/core`** — bundle read/write, validation, canonical digest, the secret-scan gate,
  and secret-ref resolution helpers. Framework-agnostic.
- **`packages/cli`** — the `uniqent` CLI (`init/validate/pack/sign/verify/inspect/export/install`).
  Thin wrappers over core + adapters. The `install` command is a 7-step wizard
  (verify → pick target → plan/permissions → memory preview → resolve creds → sandbox dry-run → apply).
- **`packages/adapter-sdk`** — the `Adapter` interface (`detect/plan/apply/export`) + a
  **conformance harness** that runs `export → pack → validate → plan → apply` into a sandbox and
  asserts: no secrets written, lossiness fully reported, apply idempotent on a second run.
- **`packages/adapter-{openclaw,hermes,claude-code}`** — one Adapter each. Hermes has bounded
  memory (`MEMORY.md` ~2200 chars, `USER.md` ~1375 chars) and MUST prioritize by `importance`
  and report truncation.

The translation flow is the moat: a canonical `Bundle` is dry-analyzed by `adapter.plan()` into
an `InstallPlan` (writes + mcp/channel registrations + a lossiness report + required creds), then
`adapter.apply()` writes it idempotently using already-resolved credentials. `adapter.export()`
reverses a native setup back into a canonical bundle.

## Current status

**Pre-M0 → M0 in progress.** Monorepo scaffold + licenses + docs being set up; `packages/spec`
being implemented. No adapters or CLI commands exist yet. When a milestone's acceptance criteria
in `docs/BUILD_PLAN.md` pass, update this status line and add any newly-discovered exact commands
or gotchas above.
