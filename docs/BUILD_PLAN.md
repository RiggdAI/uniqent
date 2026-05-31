# Uniqent — Build Plan

> **What this document is:** the engineering spec and execution plan for building Uniqent. Read this fully before writing code. Work milestone by milestone, top to bottom. Do not skip the acceptance criteria — each milestone is "done" only when its criteria pass.
>
> **Status:** M0 (foundation) complete. See §6 for the current milestone.

---

## 0. Project in one paragraph

Uniqent is a **complete, open-source platform for portable AI agents** — an n8n-inspired workflow for **building, packaging, sharing, and installing whole agent "brains."** A user composes a brain — persona, memory, skills, MCP servers, tools, automations, channels, and runtime config — in a visual local-first builder (**Uniqent Studio**), and exports it as a single signed `.uniqent` bundle. Anyone can then **install that bundle in one click into the agent framework they run** (OpenClaw, Hermes, Claude Code, …). A per-framework **adapter** translates the canonical bundle into that framework's native layout. Secrets never ship inside bundles — they're resolved locally at install. The **primary** way to create a brain is **authoring from scratch in Studio**; **capturing/exporting an existing agent** is the secondary on-ramp.

**What Uniqent is and is not:** Uniqent is the **builder + packager + translator + installer**. It is *not* the place an agent runs day-to-day — that's the framework (OpenClaw, Claude Code, …). n8n is both a builder and an exporter of its own workflows; Uniqent is deliberately the layer *above* the frameworks, so the same brain travels between all of them. We don't own where brains run; we own how they're built and how they travel.

**Non-negotiable principles (do not violate these):**
1. **Secrets never travel in a bundle.** Bundles declare credential *requirements*; the installer resolves them locally into the target framework's own credential store. Studio runs locally precisely so it can handle secrets without sending them anywhere.
2. **Bundles install from a raw file or URL** without requiring our hosted registry. The registry is optional convenience, never a hard dependency.
3. **Install is a translation, not a copy.** One canonical format → per-adapter native output.
4. **Open source.** Spec is public-domain-style (CC0); code (Studio, builder, CLI, core, adapters) is Apache-2.0. Keep license headers correct. A hosted Studio is a *future, separate* offering and is **not** part of the open v1.
5. **Trust is first-class.** Signing, a permission manifest, and a sandboxed dry-run are part of v1, not later.
6. **Lossy is acceptable, silent loss is not.** When a target can't hold something (e.g. memory size limits), truncate/transform AND report exactly what changed.

---

## 1. Tech stack & repo conventions

- **Language:** TypeScript (Node 22.13+; the pinned pnpm requires it). ESM modules.
- **Monorepo:** pnpm workspaces.
- **Schema/validation:** `zod` for runtime validation + generate JSON Schema from it (`zod-to-json-schema`).
- **Archive:** `tar` + gzip for `.uniqent` files (a `.uniqent` is a gzipped tar with a defined layout).
- **Signing:** `@noble/ed25519` (Ed25519 keypairs; detached signature over a canonical digest of bundle contents).
- **Studio (web builder):** **local-first** — a small local Node server exposing the builder engine + core (file I/O, secret-scan, sign, install), with a browser UI (React + Vite; Tailwind or similar). Launched locally (e.g. `npx @uniqent/studio` / `uniqent studio`); opens in the user's browser. No data leaves the machine.
- **CLI:** `commander` (or `clipanion`). The CLI is a **secondary / power-user + automation surface** that reuses the same `builder` and `core` packages as Studio. Keep it thin; logic lives in core packages.
- **Testing:** `vitest`. Every package ships unit tests; adapters ship round-trip integration tests; the builder engine is tested headlessly (no UI) so the UI rests on a proven core.
- **Lint/format:** eslint + prettier. CI must run lint + typecheck + build + test on every PR.
- **Conventional commits.** Keep PRs small and milestone-scoped.

### Monorepo layout
```
uniqent/
├── packages/
│   ├── spec/            # the .uniqent schema (zod) + generated JSON Schema + SPEC.md. SOURCE OF TRUTH.
│   ├── core/            # bundle read/write, validation, digest, secret-scan, signing/verify, secret-ref resolution
│   ├── builder/         # framework-agnostic "assemble a brain" engine + catalogs (MCP, skills). Studio + CLI both use it.
│   ├── adapter-sdk/     # the Adapter interface + shared helpers + a conformance test harness
│   ├── adapter-openclaw/
│   ├── adapter-hermes/
│   ├── adapter-claude-code/
│   ├── cli/             # `uniqent` CLI (secondary surface; reuses builder + core + adapters)
│   └── registry/        # open registry client/server MVP (M6)
├── apps/
│   └── studio/          # Uniqent Studio — the local-first visual builder (THE priority deliverable)
├── examples/            # sample bundles (dev-powerpack, research-analyst, …)
├── docs/                # SPEC.md, BUILD_PLAN.md, GOVERNANCE.md, CONTRIBUTING.md, SECURITY.md
├── LICENSE              # Apache-2.0 (code)
├── LICENSE-SPEC         # CC0 (the spec text + schema)
└── README.md
```

---

## 2. The `.uniqent` bundle format (canonical schema)

A `.uniqent` file is a gzipped tar of this directory:

```
<bundle>/
├── uniqent.json             # manifest (REQUIRED) — see schema below
├── signature.json           # detached Ed25519 signature + pubkey + digest (added by `sign`)
├── identity/
│   ├── persona.md           # personality, voice, role, goals (the "brain")
│   └── policies.md          # rules, safety boundaries, delegation/autonomy notes (optional)
├── memory/
│   ├── profile.json         # structured "who the user/agent is"
│   ├── facts.jsonl          # durable facts/decisions; one JSON object per line (see MemoryItem)
│   └── episodic.jsonl       # optional conversation-derived memory (bounded, scrubbable)
├── skills/
│   └── <skill-name>/SKILL.md  # standard cross-agent SKILL.md folders (+ optional scripts/, references/)
├── mcp/
│   └── servers.json         # MCP server declarations (transport, endpoint/command, auth TYPE, tool allowlist, credentialRef)
├── tools/
│   └── tools.json           # native/built-in tool enablement (web search, browser, code exec, …)
├── tasks/
│   └── *.json               # automations: schedule/trigger + action (e.g. daily briefing)
├── channels/
│   └── channels.json        # messaging surfaces (telegram/discord/slack/whatsapp/…) with credentialRefs
└── setup/
    └── runtime.json         # model/provider prefs, defaults, autonomy level, tool allowlist
```

> The zod schema in `packages/spec` is the source of truth and is already implemented (M0). The shapes below are the spec summary; `docs/SPEC.md` is generated from the code.

### 2.1 Manifest (`uniqent.json`)

```ts
SpecVersion           = "0.1"
Manifest = {
  specVersion: SpecVersion,
  name: string,                 // slug-safe
  displayName: string,
  version: string,              // semver
  description: string,
  author: { name: string, handle?: string, url?: string, pubkey?: string },
  license: string,              // SPDX id for the bundle's own content
  tags: string[],
  components: {                  // declared presence + counts, for quick inspection
    identity: boolean,
    memory: { facts: number, episodic: number, hasProfile: boolean },
    skills: string[], mcp: string[], tools: string[], tasks: string[], channels: string[],
  },
  credentials: CredentialRequirement[],   // THE INSTALL CONTRACT (see 2.2)
  permissions: PermissionScope,           // see 2.3
  compatibility: { targets: string[] },   // adapter hints; targets the author CLAIMS support for
  signatureRef?: "signature.json",
}
```

### 2.2 Credential requirements (the heart of instant setup + safety)

```ts
CredentialRequirement = {
  ref: string,                  // referenced elsewhere as credentialRef: "<ref>"
  label: string,                // human prompt e.g. "GitHub Personal Access Token"
  type: "apiKey" | "bearer" | "header" | "oauth2" | "envVar",
  consumedBy: string[],         // e.g. ["mcp:github", "channel:telegram"]
  required: boolean,            // optional creds degrade gracefully (disable that component)
  help?: string,                // where/how to get it (URL or instructions)
  oauth?: { authorizationUrl?: string, scopes?: string[], note?: string },  // only when type === "oauth2"
}
```
**Rule:** No field anywhere in a bundle may contain a secret *value*. `scanForSecrets()` in `core` (entropy + known-key-prefix heuristics: `sk-`, `ghp_`, `xoxb-`, etc.) runs during `pack`, `validate`, `sign`, and **inside Studio's review step**, and FAILS the operation if a likely secret is found in any file. This is a hard gate.

### 2.3 Permission scope (shown to user at install; auto-derived by Studio where possible)

```ts
PermissionScope = {
  filesystem: { read: string[], write: string[] },
  network: { endpoints: string[] },
  autonomy: "manual" | "suggest" | "auto",
  spawnsProcesses: boolean,
  notes?: string,
}
```

### 2.4 MCP server declaration (`mcp/servers.json`)

```ts
McpServer = {
  id: string,
  transport: "streamable-http" | "sse" | "stdio",
  url?: string,                                                    // for http/sse
  command?: string, args?: string[], env?: Record<string,string>, // for stdio; env values may be "${credentialRef:...}" placeholders ONLY
  auth: { type: "none" | "bearer" | "header" | "oauth2", credentialRef?: string, headerName?: string },
  tools: { include: "all" | string[] },                            // allowlist
  description?: string,
}
```

### 2.5 MemoryItem (lines in `facts.jsonl` / `episodic.jsonl`)

```ts
MemoryItem = {
  id: string,
  kind: "fact" | "decision" | "preference" | "milestone" | "episodic",
  text: string,
  source?: string,              // provenance: where this came from
  createdAt: string,            // ISO 8601
  importance?: number,          // 0..1, used when a target must prioritize/truncate
  visibility?: "shareable" | "personal",   // default "shareable"; export scrubs "personal" + episodic by default
  tags?: string[],
}
```
**Memory privacy rules (for the knowledge-retention use case):** `visibility` defaults to `"shareable"`. `uniqent export` (capture) **drops episodic + `personal` memory by default**, unless explicitly included (e.g. `--include-episodic`). Studio's memory panel and the install-time memory preview group items by visibility so a user can scrub/keep before sharing or installing.

---

## 3. The Adapter contract (the moat — get this right)

Every framework target implements one Adapter. Define this interface in `packages/adapter-sdk`:

```ts
interface Adapter {
  id: string;                                   // "openclaw" | "hermes" | "claude-code"
  displayName: string;

  detect(): Promise<{ present: boolean; version?: string; configRoot?: string }>;       // is the framework here?
  plan(bundle: Bundle, opts: InstallOptions): Promise<InstallPlan>;                      // dry analysis, no writes
  apply(bundle: Bundle, plan: InstallPlan, resolved: ResolvedCredentials): Promise<InstallResult>;  // idempotent
  export(opts: ExportOptions): Promise<Bundle>;                                          // reverse: native → canonical
}

InstallPlan = {
  writes: Array<{ path: string; summary: string }>,
  mcpRegistrations: string[],
  channelRegistrations: string[],
  lossiness: Array<{ component: string; issue: string; action: "truncated"|"dropped"|"transformed" }>,
  requiresCredentials: string[],   // refs that must be resolved before apply()
}
```

### Per-adapter mapping notes

**OpenClaw** (`~/.openclaw/`, config root may be overridden by `OPENCLAW_STATE_DIR`):
- identity/persona.md → `SOUL.md` / `IDENTITY.md`; memory/* → `MEMORY.md` (+ user profile); skills/* → `~/.openclaw/skills/<name>/`; mcp/servers.json → `openclaw.json`; tasks/channels → openclaw.json equivalents.

**Hermes** (`~/.hermes/`):
- identity → system prompt / identity files; memory **bounded** — `MEMORY.md` (~2200 chars) and `USER.md` (~1375 chars), MUST prioritize by `importance` and report truncation in `lossiness`, overflow → suggest external memory provider; skills → `~/.hermes/skills/`; credentials → `.env`; channels → Hermes gateway config.

**Claude Code** (`~/.claude/` or project `.claude/`):
- skills → `.claude/skills/` (already native, cross-agent SKILL.md — a copy, not a transform); identity/persona → `CLAUDE.md` / `AGENTS.md`; mcp → MCP server config (`.mcp.json`/settings); memory → project memory file (best-effort; Claude Code memory model differs).
- NOTE: "Claude" = Claude Code/Desktop file-based surfaces (installable), NOT the managed claude.ai web app (skills + connectors only; partial target).

**Conformance harness (build in adapter-sdk):** for any adapter, run `export → pack → validate → plan → apply` into a temp sandbox and assert: no secrets written, lossiness fully reported, apply idempotent on second run.

---

## 4. Uniqent Studio (the visual builder — THE priority deliverable)

Studio is the n8n-style, **local-first** experience for building and packaging a brain from scratch. It is a browser UI served by a local Node process; it reads/writes a working bundle directory on disk and uses `packages/builder` + `packages/core` for all logic (so the CLI can reuse the exact same engine).

**Author flow (compose → review → pack → share):** each panel maps 1:1 to a bundle component, so Studio is a visual editor over the spec.

| Panel | What the user does | Writes |
|-------|--------------------|--------|
| Identity | persona/role/voice/goals (markdown editor + templates) | `identity/persona.md`, `policies.md` |
| Stack (MCP) | add servers from a **catalog**, set transport + tool allowlist, declare credential *requirements* | `mcp/servers.json` + `credentials[]` |
| Skills | pick from a **library** or write/import `SKILL.md` | `skills/*` |
| Memory | seed facts/preferences/profile; set `importance` + `visibility` | `memory/*` |
| Tools / Tasks / Channels | toggle native tools; define automations (trigger + action); add channels w/ credentialRefs | `tools/`, `tasks/`, `channels/` |
| Config | model/provider, autonomy, allowlists | `setup/runtime.json` |
| Review | **live validation, secret-scan, auto-derived permission sheet**, credential summary | a valid `.uniqent` |

**What makes it complete (not a form-filler):**
1. **Catalogs** — curated MCP-server catalog and skills library so users pick, not memorize JSON. (`packages/builder` owns the catalog abstraction; entries are data, contributable.)
2. **Always-valid output** — live zod validation + secret-scan + auto permission/credential derivation, so every export is installable and safe.
3. **One engine** — Studio is a thin UI over `packages/builder`; the headless engine is unit-tested independently, and a CLI/automation surface reuses it.

**Pack / sign / share:** Review → `core.pack()` (runs validate + secret-scan) → optional `core.sign()` → save `.uniqent`, copy an install URL, or publish to the registry (M6). **Install from Studio:** Studio can also run the install flow locally (detect frameworks → plan → resolve creds → dry-run → apply) so a user can build and try a brain on their own machine end to end.

---

## 5. CLI surface (`packages/cli`) — secondary / automation

The CLI reuses `builder` + `core` + adapters. It exists for headless/CI/power-user flows; Studio is the primary UX.

```
uniqent studio               # launch the local Studio web app
uniqent init                 # scaffold a new bundle directory with templates (headless authoring)
uniqent validate <path>      # zod-validate manifest + layout + secret-scan. Exit non-zero on fail.
uniqent pack <dir> [-o file] # build .uniqent (gzip tar). Runs validate + secret-scan first.
uniqent sign <file> --key    # add signature.json (Ed25519 over canonical digest)
uniqent verify <file>        # verify signature + digest integrity
uniqent inspect <file>       # print manifest, components, permissions, credential requirements
uniqent export --from <fw>   # capture an existing local agent into a bundle (scrubs personal/episodic by default)
uniqent install <file|url> [--target <fw>] [--yes]   # detect → plan → permissions+lossiness → resolve creds → dry-run → apply
```

**`install` flow (also implemented in Studio):**
1. Load bundle (path or URL). `verify` signature; loud warning if unsigned/unverified.
2. Pick target (flag, or interactive from detected frameworks).
3. `adapter.plan()` → render permission sheet + lossiness report. Require confirm.
4. Memory preview → allow redact/skip per item or in bulk (grouped by `visibility`).
5. Resolve credentials: prompt for apiKey/bearer/header/envVar; browser flow for oauth2. Store into the **target framework's** credential store, never back into the bundle.
6. Dry-run in sandbox: load agent, list resolved tools/MCP tools, confirm memory+persona loaded. Green "ready" summary.
7. `adapter.apply()`. Print what was written + how to launch.

---

## 6. Milestones (build in this order)

### M0 — Repo + spec foundation ✅ DONE
- pnpm monorepo, CI, licenses (Apache-2.0 + CC0), README, CONTRIBUTING, GOVERNANCE, SECURITY.
- `packages/spec`: full zod schema for §2; generated JSON Schema; generated `docs/SPEC.md`.
- **Acceptance (met):** build + typecheck + lint + format + tests green; JSON Schema generated; example manifest validates; schema-drift guard test.

### M1 — Core engine
- `core`: read/write bundle, validate, canonical digest, **secret-scan gate**, **Ed25519 sign/verify**, secret-ref resolution helpers.
- Add `MemoryItem.visibility` to `packages/spec`; regenerate JSON Schema + SPEC.md.
- **Acceptance:** round-trip pack/unpack byte-stable for content digest; `validate`/`pack` reject an embedded fake `sk-...` key; tampering after `sign` makes `verify` fail.

### M2 — Builder engine (`packages/builder`)
- Framework-agnostic "assemble a brain" API: create/edit an in-memory Brain model, add/remove components, **live validate against spec**, auto-derive permissions + credential requirements, emit a `Bundle` (and unpack one back into the model).
- Catalog abstraction + seed entries (a few MCP servers; a starter skills library).
- **Acceptance (headless, no UI):** programmatically assemble a brain → validate → pack → it installs in M4; secret-scan blocks a seeded secret; permission sheet auto-derived from components.

### M3 — Uniqent Studio (local-first web builder) — THE PRIORITY
- `apps/studio`: local Node server + browser UI over `builder` + `core`. All panels in §4; Review with live validation + secret-scan + permission preview; pack + sign + save/copy-URL.
- `uniqent studio` launches it.
- **Acceptance (the headline demo):** with zero hand-editing, a user builds a brain from scratch in the browser — persona + ≥1 MCP server (with declared credential requirement, no secret) + ≥1 skill + seeded memory — hits Review (validates, 0 secrets, permission sheet shown), and exports a signed `.uniqent` that passes `uniqent validate`.

### M4 — Adapter SDK + first adapters (Claude Code, OpenClaw) + install
- `adapter-sdk` (interface §3) + conformance harness.
- `adapter-claude-code` and `adapter-openclaw`: `detect/plan/apply/export`.
- Wire install into both Studio and CLI (plan → permissions/lossiness → resolve creds → dry-run → apply).
- **Acceptance:** a brain built in Studio installs into a clean sandbox for both targets; conformance harness passes (no secrets, lossiness reported, idempotent).

### M5 — Hermes adapter + capture (export) + cross-framework proof
- `adapter-hermes` with bounded-memory prioritization + lossiness reporting.
- `export` (capture an existing agent) wired into Studio + CLI, scrubbing personal/episodic by default.
- **Acceptance (proves the thesis):** capture an OpenClaw/Claude Code agent → install `--target hermes` → the Hermes agent loads persona, retains prioritized memory (with a truncation report), has its MCP servers registered, and runs.

### M6 — Examples + registry (open-core) + one-click web install
- 5 example bundles (dev-powerpack, research-analyst, founder, content-creator, personal-assistant) with real MCP wiring + credential requirements (no secrets).
- Minimal open registry: publish/search/install-by-slug; semver; compatibility + signature badges.
- `uniqent://install?bundle=<url>` handler + web "Install" button handing off to the local installer. **Must also work installing from a raw GitHub URL with no registry.**
- **Acceptance:** publish an example, find via search, one-click install end to end; same bundle installs from a raw URL with the registry off; each example installs into ≥2 targets.

---

## 7. Security requirements (apply continuously)
- Hard secret-scan gate on pack/validate/sign **and in Studio's review step** (fail closed).
- Static scan of skill scripts on `validate` (flag shell-outs, network calls, obfuscation) — warn in v1, block on registry publish later.
- Signature verify on install; loud unsigned warning; install unsigned only with explicit opt-in.
- Permission sheet + memory preview always shown before any write.
- Sandboxed dry-run before `apply`.
- Studio is local-first: secrets and brain contents never leave the machine.
- `SECURITY.md` with disclosure policy.

## 8. Definition of done for v1
- Spec public + versioned.
- **Studio (local-first) builds a brain from scratch end to end**, with live validation, secret-scan, signing, and export.
- `core` + CLI cover validate/pack/sign/verify/inspect/install/export; capture (`export --from`) works.
- Three working adapters (Claude Code, OpenClaw, Hermes) passing the conformance harness.
- The cross-framework proof (M5) reproducible from a documented sequence.
- 5 example bundles. Open registry MVP. Bundles installable from a raw URL with zero hosted dependency.
- All non-negotiable principles (§0) hold; secret-scan gate proven by tests.

## 9. Explicitly out of scope for v1 (do not build yet)
- A **hosted** Studio / SaaS (a future, separate open-core offering; v1 Studio is local-first only).
- Paid marketplace / billing.
- Enterprise SSO / fleet install.
- Adapters beyond the three above (Codex, Cursor, Gemini come after v1 — though the format is designed to accommodate them).
- Dynamic persona "evolution" / runtime learning loops.

---

## 10. Next actions
1. **M1 — Core engine:** implement `packages/core` (bundle r/w, digest, secret-scan, sign/verify) + add `MemoryItem.visibility` to the spec and regenerate artifacts. Tests for the digest stability, secret-scan gate, and tamper detection.
2. **M2 — Builder engine:** `packages/builder` assemble-a-brain API + catalogs, tested headlessly.
3. **M3 — Studio:** the local-first web builder over that engine.
4. Open a PR per milestone. Stop at each acceptance gate and report results before continuing.
```
