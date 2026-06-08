# Design: The "wow" first-run — `npx @uniqent/cli try <brain>`

**Date:** 2026-06-08
**Status:** Approved (design); pending implementation plan
**Goal:** Turn a first-time GitHub visitor into a "holy cow, it works in my agent" user in **one
command, ~60 seconds, zero config, zero API keys** — the single highest-leverage lever for stars.

## Decisions locked with the user

- **Lever:** the "wow" first-run (not new features, polish, or launch comms).
- **Target framework:** **Claude Code first** (biggest star audience); Hermes/OpenClaw still work.
- **Hero brain:** **`research-analyst`**, enriched in place (not a brand-new brain).
- **Resolution approach:** **A — bake pre-packed signed bundles into the CLI package** (offline,
  instant, version-pinned), with the existing URL/slug/file resolver as the fallback.
- **Spec addition:** an optional `suggestedPrompts?: string[]` on the manifest, powering the
  closing "now ask it this" line for any brain.

## Problem (current first-run friction)

1. **No one-command path.** Trying `research-analyst` today means `npm i -g @uniqent/cli`, finding
   a bundle URL/file, then `uniqent install <file> --target claude-code --root <dir>` — three steps
   plus arguments.
2. **No auto-detect.** `install` defaults `--root` to cwd and `--target` to `claude-code` but never
   _looks_ for the user's framework. Each adapter already exposes `detect({root})` — it is simply
   unused for routing.
3. **Thin hero brain.** `research-analyst` is a 3-line persona, **1** memory fact, the `fetch` MCP,
   and one `summarize` skill. The memory-brain graph would be nearly empty.
4. **No payoff.** `install` ends with "Open the project in Claude Code." — no suggested prompt.
5. **README buries it.** Quickstart leads with vault capture, not the wow.

Crucial enabler: `research-analyst` needs **zero credentials** (creds-free web `fetch` MCP), so a
genuinely zero-config install is possible.

## The command

```
$ npx @uniqent/cli try research-analyst

  detected: Claude Code (~/.claude)        ← auto-detected, no flags
  signature: valid ✓
  installing Research Analyst…
    ✓ persona → AGENTS.md
    ✓ summarize skill → .claude/skills/
    ✓ web-fetch MCP → .mcp.json   (no API key needed)
    ✓ 12 memories → knowledge graph

  Done. Open this folder in Claude Code and ask:
  → "Research the best vector database for a RAG app and cite every claim."
```

### CLI surface

```
uniqent try <brain> [--target <id>] [--root <dir>] [--yes] [--list]
```

- `<brain>` — a featured-brain name (e.g. `research-analyst`), or any slug/URL/file (falls through
  to the existing `resolveBundle`).
- `--target` / `--root` — optional overrides; omitted ⇒ auto-detect.
- `--list` — print the featured brains and their one-line pitch.
- `--yes` — skip the single confirm (CI/non-interactive).

`try` reuses the existing `install` pipeline verbatim — it is sugar, not a parallel code path.

## Architecture

Keep the CLI thin (repo rule: logic lives in core packages). New/changed units:

### 1. Featured-brain resolution — `@uniqent/builder`

A small framework-agnostic module that owns the featured set and detection routing so both the CLI
and (later) Studio can share it.

- **`featuredBrains(): FeaturedBrain[]`** — returns the curated list: `{ name, displayName, pitch,
suggestedPrompts }`. Source of truth is a single data file; the actual bundle bytes are loaded by
  the CLI (which knows its own package layout) — builder stays fs-agnostic.
- **`detectTarget(adapters, { cwd, home }): Promise<{ id, configRoot } | null>`** — iterates the
  given adapters calling `detect()`, returns the first present by priority
  (`claude-code` → `openclaw` → `hermes`). Pure orchestration over the adapter interface; no new
  detect logic.

> **What it does / how you use it / what it depends on:** `detectTarget` answers "which framework
> is on this machine and where" given the adapter list and two dirs; it depends only on the
> `Adapter.detect` contract. `featuredBrains` answers "what can I `try` and what should I ask it";
> it depends on nothing but the static list.

### 2. Featured bundles shipped in `@uniqent/cli`

- A `featured/` directory of pre-packed **signed** `.uniqent` files is added to the package `files`
  allowlist so it ships with `npm publish` (and is therefore present under `npx`).
- A tiny `loadFeatured(name)` helper in the CLI reads `featured/<name>.uniqent` from its own
  `dist`-relative path and `unpack`s it.
- **Build/release:** a `pnpm --filter @uniqent/cli build:featured` script packs each example source
  dir (`examples/<name>`) via `@uniqent/core` `readDir → pack`, signs it with the project release
  key, and writes `featured/<name>.uniqent`. The private key is a CI secret; the matching public key
  is committed for verification. Tests use an **ephemeral keypair** so they never need the real key.
- Trust beat preserved: `try` runs the normal `verify()`; featured bundles show `signature: valid ✓`.

### 3. The `try` command — `packages/cli/src/run.ts`

```
try(args, io):
  parse args (--list, --target, --root, --yes, positional <brain>)
  if --list: print featured set + pitches; return 0
  resolve bundle:
    if <brain> in featured set → loadFeatured(name)        # approach A
    else → resolveBundle(<brain>, flags)                   # URL/slug/file fallback (existing)
  target = flags.target ?? (await detectTarget(ADAPTERS, {cwd, home}))?.id ?? 'claude-code'
  root   = flags.root   ?? detected.configRoot ?? cwd      # claude-code: cwd; create .claude if absent
  print "detected: <displayName> (<root>)"
  run the existing verify → plan → (print plan + lossiness) → resolve creds → confirm → apply flow
  print suggestedPrompts payoff block from the manifest
```

The verify/plan/apply body is the **same** code `install` uses — extracted into a shared
`runInstall(bundle, {target, root, creds, autoYes}, io)` helper so `install` and `try` cannot drift.

### 4. Enrich `research-analyst` (canonical source in `examples/research-analyst`)

- **Persona** — sharper, more characterful, still the meticulous citer; a few short paragraphs.
- **Memory** — grow `memory/facts.jsonl` from 1 → ~12 facts using Obsidian `[[entities]]` and
  `#tags` (sources, methods, citation rules) so the memory-brain graph is genuinely rich. All facts
  `visibility: shareable`, no secrets.
- **Skill** — enrich `skills/summarize/SKILL.md` so the agent visibly behaves like a research
  analyst (fetch → quote → cite → flag uncertainty).
- **MCP** — keep the **creds-free** web `fetch` server (zero API keys). `credentials: []` stays.
- **Manifest** — add `suggestedPrompts` (e.g. the vector-DB prompt above), bump component counts,
  keep `compatibility.targets` = all three.

### 5. Spec — `packages/spec/src/manifest.ts`

Add `suggestedPrompts: z.array(z.string()).optional()` to `Manifest`. Regenerate JSON Schema +
`docs/SPEC.md` via `pnpm --filter @uniqent/spec gen`. Backward-compatible (optional).

### 6. README rewrite

Move the **one-command `try`** block and a demo asset directly under the tagline as the first thing
a visitor sees; relocate the architecture diagram and vault-capture below "Quickstart". No claims
beyond what the code does.

### 7. Demo asset

A committed terminal-cast of the `try` flow for the README, plus the exact reproducible record
command. Realistic deliverable: a clean **animated SVG "termcast"** (or asciinema `.cast` + an
SVG render) generated from a scripted run, committed under `docs/img/`. A real screen recording of
the user's own Claude Code answering is left as an optional follow-up (it shows their machine).

## Data flow

```
npx @uniqent/cli try research-analyst
  → loadFeatured('research-analyst')         (bundle bytes from the CLI package)
  → unpack + verify                          (signature: valid ✓)
  → detectTarget(ADAPTERS,{cwd,home})        (→ claude-code @ cwd)
  → adapter.plan(bundle,{root})              (writes + lossiness, requiresCredentials = [])
  → print plan
  → adapter.apply(...)                       (idempotent native write)
  → print manifest.suggestedPrompts          (the payoff)
```

## Error handling

- **No framework detected** → default to `claude-code` in cwd, create `.claude/`, and _say so_
  ("no agent detected — set up Claude Code here").
- **Unknown brain name** (not featured, not a valid slug/URL/file) → list the featured brains and
  exit non-zero.
- **Signature invalid** → refuse, same as `install` (the bundled set is signed, so this only trips
  on tampering).
- **Featured file missing from package** (packaging regression) → clear error naming the expected
  path; a packaging test guards against this.
- **Credentials required** (non-featured brain) → fall back to `install`'s existing prompt/flag/env
  resolution; featured `research-analyst` requires none.

## Testing

- **`try` auto-detect** — given a temp dir containing `.claude/`, `detectTarget` picks `claude-code`
  with the right `configRoot`; given an empty dir, returns `null` and `try` falls back + warns.
- **`try` resolves a featured brain** and applies into a sandbox; second run is idempotent.
- **`--list`** prints the featured set.
- **`research-analyst` still validates + packs with no secrets** (existing `examples.test.ts`
  extended for the enriched memory) and exposes `suggestedPrompts`.
- **Spec** — `suggestedPrompts` accepted and round-trips through JSON Schema generation.
- **Packaging** — `featured/research-analyst.uniqent` is present and `verify()`s under an ephemeral
  test key; the package `files` list includes `featured`.
- **Shared `runInstall`** — `install` and `try` exercise the same pipeline (one test asserts both
  produce identical writes for the same bundle/target/root).
- **Manual end-to-end** — build, then run the built `dist/bin.js try research-analyst` into a
  throwaway dir and confirm the full wow output and the suggested-prompt block.

## Out of scope (YAGNI)

- Hosted registry service / accounts / web "Install" button (`uniqent://`) — unchanged, post-v1.
- New adapters (Cursor/Gemini/Codex).
- A brand-new hero brain (we enrich the existing one).
- Recording the user's actual Claude Code session answering the prompt.

## Acceptance

`npx @uniqent/cli try research-analyst` on a clean machine auto-detects Claude Code, installs a
signed, creds-free, memory-rich research brain in one step, and ends with a concrete prompt to try —
with the README leading on that command and a demo asset. All package tests green; `pnpm build`,
`typecheck`, `lint` clean.
