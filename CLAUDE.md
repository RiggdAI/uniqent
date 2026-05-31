# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Uniqent is

Uniqent is a **complete, open-source platform for portable AI agents** — an n8n-inspired
workflow to **build, package, share, and install whole agent "brains."** A user composes a brain
(persona, memory, skills, MCP servers, tools, automations, channels, runtime config) in a
**local-first visual builder, Uniqent Studio**, and exports it as a single signed `.uniqent`
bundle (a gzipped tar). Anyone can then **install that bundle in one click into the agent
framework they run** (OpenClaw, Hermes, Claude Code, …); a per-framework **adapter** translates
the canonical bundle into that framework's native layout.

**Authoring from scratch in Studio is the primary path; capturing/exporting an existing agent is
secondary.** Uniqent is the builder + packager + translator + installer — NOT where the agent
runs (that's the framework). Unlike n8n (which builds and exports its own workflows), Uniqent sits
_above_ the frameworks so one brain travels between all of them. The headline use case is
**institutional-knowledge continuity** — keep a departing person's agent brain and hand it to the
next hire (see project memory).

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
  Ed25519 sign/verify, and secret-ref resolution helpers. Framework-agnostic.
- **`packages/builder`** — the framework-agnostic "assemble a brain" engine + catalogs (MCP,
  skills). Create/edit a Brain model → live-validate → emit a `Bundle`. **Both Studio and the CLI
  are thin front-ends over this — build the logic once here.**
- **`apps/studio`** — **Uniqent Studio**, the local-first visual builder (browser UI + a small
  local Node server) over `builder` + `core`. **The priority deliverable / product face.** A
  hosted version is a future, separate offering, NOT part of the open v1.
- **`packages/cli`** — the `uniqent` CLI. **Secondary / power-user + automation surface**, reusing
  `builder` + `core` + adapters. `install` is a 7-step flow
  (verify → pick target → plan/permissions → memory preview → resolve creds → sandbox dry-run → apply),
  shared with Studio.
- **`packages/adapter-sdk`** — the `Adapter` interface (`detect/plan/apply/export`) + a
  **conformance harness** that runs `export → pack → validate → plan → apply` into a sandbox and
  asserts: no secrets written, lossiness fully reported, apply idempotent on a second run.
- **`packages/adapter-{claude-code,openclaw,hermes}`** — one Adapter each. Hermes has bounded
  memory (`MEMORY.md` ~2200 chars, `USER.md` ~1375 chars) and MUST prioritize by `importance`
  and report truncation.
- **`packages/registry`** — open registry MVP (publish/search/install-by-slug); optional, never a
  hard dependency.

The translation flow is the moat: a canonical `Bundle` is dry-analyzed by `adapter.plan()` into
an `InstallPlan` (writes + mcp/channel registrations + a lossiness report + required creds), then
`adapter.apply()` writes it idempotently using already-resolved credentials. `adapter.export()`
reverses a native setup back into a canonical bundle (scrubbing personal/episodic memory by
default).

## Current status

**M3 (Studio) + M4 (install, two adapters) complete — cross-framework proven.** Packages: `spec`,
`core`, `builder`, `adapter-sdk`, `adapter-claude-code`, `adapter-hermes`, `cli`; app: `studio`.

- **Studio** (`apps/studio`) — local-first React+Vite app over a Node API (`StudioSession` over the
  builder) with an **n8n-style react-flow canvas**: agent core node wired to component nodes
  (persona/MCP/skill/memory/channel/flow) + credential→consumer "needs" edges, a palette
  (catalog + custom/import for skills & MCP, channels, flows), and a side-panel inspector. Memory
  has single + bulk import (paste / `.txt`/`.md`/`.jsonl`). Run:
  `pnpm --filter @uniqent/studio build && pnpm --filter @uniqent/studio start` (`:4173`,
  `UNIQENT_STUDIO_PORT` to override). Verified in a real browser.
- **Install** — `@uniqent/adapter-sdk` (Adapter interface + conformance harness) +
  `@uniqent/adapter-claude-code` (skills→`.claude/skills`, persona+memory→`AGENTS.md`,
  MCP→merged `.mcp.json` with locally-resolved creds injected; channels/tasks/tools reported as
  lossiness) + `@uniqent/cli` (`uniqent inspect|install <file> --target claude-code --root <dir>
--cred ref=val [--allow-unsigned] [--yes]`). Verified: a signed `.uniqent` installs into a
  sandbox `.claude/` end to end.
- **Hermes** — `@uniqent/adapter-hermes`: persona→`SOUL.md`, **bounded memory** (`MEMORY.md`
  ~2200 / `USER.md` ~1375 chars, prioritized by `importance`, truncation reported in lossiness),
  skills→`skills/`, MCP+channels+tasks→`hermes.json` with credentials kept in `.env` (config holds
  only `${ENV}` refs). `uniqent install --target hermes` works. **Cross-framework proven:** the
  same `.uniqent` installs into both Claude Code and Hermes (a test asserts both, with Claude Code
  _transforming_ memory and Hermes _truncating_ it).

**Next: OpenClaw adapter + a Studio "Install" button, then registry/one-click (M6).** When a
milestone's acceptance criteria in `docs/BUILD_PLAN.md` pass, update this status line and add any
newly-discovered exact commands or gotchas above.
