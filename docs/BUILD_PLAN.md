# Uniqent — Build Plan (for Claude Code)

> **What this document is:** the engineering spec and execution plan for building Uniqent. Read this fully before writing code. Work milestone by milestone, top to bottom. Do not skip the acceptance criteria — each milestone is "done" only when its criteria pass.

---

## 0. Project in one paragraph

Uniqent is an **open standard + toolchain for portable AI agents**. A user packages a complete agent — persona/"brain", memory, skills, MCP servers, tools, automations, channels, and runtime config — into a single signed `.uniqent` bundle. Anyone can then **install that bundle in one click into the agent framework they run** (OpenClaw, Hermes, Claude Code, …). A per-framework **adapter** transpiles the canonical bundle into that framework's native layout. Secrets never ship inside bundles — the installer collects them locally. Think "n8n template export/import, but for whole agents."

**Non-negotiable principles (do not violate these):**
1. **Secrets never travel in a bundle.** Bundles declare credential *requirements*; the installer resolves them locally into the target framework's own credential store.
2. **Bundles install from a raw file or URL** without requiring our hosted registry. The registry is optional convenience, never a hard dependency.
3. **Install is a translation, not a copy.** One canonical format → per-adapter native output.
4. **Open source.** Spec is public-domain-style (CC0); CLI + adapters are Apache-2.0. Keep license headers correct.
5. **Trust is first-class.** Signing, a permission manifest, and a sandboxed dry-run are part of v1, not later.
6. **Lossy is acceptable, silent loss is not.** When a target can't hold something (e.g. memory size limits), truncate/transform AND report exactly what changed.

---

## 1. Tech stack & repo conventions

- **Language:** TypeScript (Node 20+). ESM modules.
- **Monorepo:** pnpm workspaces.
- **CLI framework:** `commander` (or `clipanion`). Keep CLI thin; logic lives in core packages.
- **Schema/validation:** `zod` for runtime validation + generate JSON Schema from it (`zod-to-json-schema`).
- **Archive:** `tar` + gzip for `.uniqent` files (a `.uniqent` is a gzipped tar with a defined layout).
- **Signing:** `@noble/ed25519` (Ed25519 keypairs; detached signature over a canonical digest of bundle contents).
- **Testing:** `vitest`. Every package ships unit tests; adapters ship round-trip integration tests.
- **Lint/format:** eslint + prettier. CI must run lint + typecheck + test on every PR.
- **Conventional commits.** Keep PRs small and milestone-scoped.

### Monorepo layout
```
uniqent/
├── packages/
│   ├── spec/            # the .uniqent schema (zod) + generated JSON Schema + SPEC.md. SOURCE OF TRUTH.
│   ├── core/            # bundle read/write, validation, signing, digest, secret-ref resolution
│   ├── cli/             # `uniqent` CLI (init, pack, validate, sign, verify, install, export, inspect)
│   ├── adapter-sdk/     # the Adapter interface + shared helpers + a conformance test harness
│   ├── adapter-openclaw/
│   ├── adapter-hermes/
│   └── adapter-claude-code/
├── examples/            # sample bundles (dev-powerpack, research-analyst, …)
├── docs/                # SPEC.md, GOVERNANCE.md, CONTRIBUTING.md, SECURITY.md
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

### 2.1 Manifest (`uniqent.json`) — zod shape (implement in `packages/spec`)

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
    skills: string[],           // skill names
    mcp: string[],              // mcp server ids
    tools: string[],
    tasks: string[],
    channels: string[],
  },
  credentials: CredentialRequirement[],   // THE INSTALL CONTRACT (see 2.2)
  permissions: PermissionScope,           // see 2.3
  compatibility: {                        // adapter hints
    targets: string[],          // e.g. ["openclaw", "hermes", "claude-code"] author CLAIMS support
  },
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
  oauth?: {                     // present only when type === "oauth2"
    authorizationUrl?: string,
    scopes?: string[],
    note?: string,
  },
}
```
**Rule:** No field anywhere in a bundle may contain a secret *value*. Implement a `scanForSecrets()` check in `core` (entropy + known-key-prefix heuristics: `sk-`, `ghp_`, `xoxb-`, etc.) that runs during `pack`, `validate`, and `sign`, and FAILS the operation if a likely secret is found in any file. This is a hard gate.

### 2.3 Permission scope (shown to user at install)

```ts
PermissionScope = {
  filesystem: { read: string[], write: string[] },   // path globs, "" if none
  network: { endpoints: string[] },                   // domains the agent/MCP will reach
  autonomy: "manual" | "suggest" | "auto",            // how freely it acts
  spawnsProcesses: boolean,
  notes?: string,
}
```

### 2.4 MCP server declaration (`mcp/servers.json`)

```ts
McpServer = {
  id: string,
  transport: "streamable-http" | "sse" | "stdio",
  // for http/sse:
  url?: string,
  // for stdio:
  command?: string, args?: string[], env?: Record<string,string>,  // env values may be "${credentialRef:...}" placeholders ONLY
  auth: { type: "none" | "bearer" | "header" | "oauth2", credentialRef?: string, headerName?: string },
  tools: { include: "all" | string[] },               // allowlist
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
  tags?: string[],
}
```

---

## 3. The Adapter contract (the moat — get this right)

Every framework target implements one Adapter. Define this interface in `packages/adapter-sdk`:

```ts
interface Adapter {
  id: string;                                   // "openclaw" | "hermes" | "claude-code"
  displayName: string;

  // Can this adapter install into this machine? (is the framework present?)
  detect(): Promise<{ present: boolean; version?: string; configRoot?: string }>;

  // Dry analysis: what WOULD happen. No writes. Returns a plan + lossiness report.
  plan(bundle: Bundle, opts: InstallOptions): Promise<InstallPlan>;

  // Perform install using already-resolved credentials. Idempotent where possible.
  apply(bundle: Bundle, plan: InstallPlan, resolved: ResolvedCredentials): Promise<InstallResult>;

  // Reverse: read an existing native setup into a canonical Bundle (for `export`).
  export(opts: ExportOptions): Promise<Bundle>;
}

InstallPlan = {
  writes: Array<{ path: string; summary: string }>,
  mcpRegistrations: string[],
  channelRegistrations: string[],
  lossiness: Array<{ component: string; issue: string; action: "truncated"|"dropped"|"transformed" }>,
  requiresCredentials: string[],   // refs that must be resolved before apply()
}
```

### Per-adapter mapping notes (implement to these targets)

**OpenClaw** (`~/.openclaw/`, config root may be overridden by `OPENCLAW_STATE_DIR`):
- identity/persona.md → `SOUL.md` / `IDENTITY.md`
- memory/* → `MEMORY.md` (+ user profile section)
- skills/* → `~/.openclaw/skills/<name>/`
- mcp/servers.json → register in `openclaw.json`
- tasks/channels → openclaw.json equivalents

**Hermes** (`~/.hermes/`):
- identity → system prompt / identity files
- memory: **bounded** — `MEMORY.md` (~2200 chars) and `USER.md` (~1375 chars). MUST prioritize by `importance` and report what was truncated in `lossiness`. Overflow → suggest external memory provider.
- skills → `~/.hermes/skills/`
- credentials prompt for `.env`
- channels → Hermes gateway config

**Claude Code** (`~/.claude/` or project `.claude/`):
- skills → `.claude/skills/` (already native, cross-agent SKILL.md)
- identity/persona → `AGENTS.md` / project instructions
- mcp → MCP server config
- memory → project memory file (best-effort; note Claude Code memory model differs)
- NOTE: be explicit in docs that "Claude" = Claude Code/Desktop surfaces (file-based, installable), NOT the managed claude.ai web app.

**Conformance harness (build in adapter-sdk):** a generic test that, for any adapter, runs `export → pack → validate → plan → apply` into a temp sandbox and asserts: no secrets written, lossiness fully reported, apply is idempotent on second run.

---

## 4. CLI surface (`packages/cli`)

```
uniqent init                 # scaffold a new bundle directory with templates
uniqent validate <path>      # zod-validate manifest + layout + secret-scan. Exit non-zero on fail.
uniqent pack <dir> [-o file] # build .uniqent (gzip tar). Runs validate + secret-scan first.
uniqent sign <file> --key    # add signature.json (Ed25519 over canonical digest)
uniqent verify <file>        # verify signature + digest integrity
uniqent inspect <file>       # print manifest, components, permissions, credential requirements
uniqent export --from <fw>   # use an adapter to package an existing local agent into a bundle
uniqent install <file|url> [--target <fw>] [--yes]
                             # detect → plan → show permissions+lossiness → resolve creds → dry-run → apply
```

`install` flow (the n8n-style wizard — implement exactly):
1. Load bundle (from path or URL). `verify` signature; warn loudly if unsigned/unverified.
2. Pick target (flag, or interactive from detected frameworks).
3. `adapter.plan()` → render permission sheet + lossiness report. Require confirm.
4. Memory preview → allow redact/skip per item or in bulk.
5. Resolve credentials from manifest: prompt for apiKey/bearer/header/envVar; run browser flow for oauth2. Store into the **target framework's** credential store, never back into the bundle.
6. Dry-run in sandbox: load agent, list resolved tools/MCP tools, confirm memory+persona loaded. Show green "ready" summary.
7. `adapter.apply()`. Print what was written + how to launch.

---

## 5. Milestones (build in this order)

### M0 — Repo + spec foundation
- pnpm monorepo, CI (lint/typecheck/test), licenses (Apache-2.0 + CC0 for spec), README, CONTRIBUTING, GOVERNANCE, SECURITY.
- `packages/spec`: full zod schema for everything in §2; generate JSON Schema; write `docs/SPEC.md` from it.
- **Acceptance:** `pnpm -r build && pnpm -r test` green; JSON Schema generated; SPEC.md matches schema; example manifest validates.

### M1 — Core + CLI basics
- `core`: read/write bundle, validate, canonical digest, **secret-scan gate**, secret-ref resolution helpers.
- `cli`: `init`, `validate`, `pack`, `inspect`.
- **Acceptance:** can scaffold → pack → inspect a bundle; `validate` rejects a manifest with an embedded fake `sk-...` key; round-trip pack/unpack is byte-stable for content digest.

### M2 — Signing & trust
- Ed25519 keygen, `sign`, `verify`. Signature covers a canonical digest of all bundle files.
- `inspect` shows signature status + permission sheet + credential requirements.
- **Acceptance:** tampering with any file after signing makes `verify` fail; unsigned bundles install only with an explicit `--allow-unsigned` and a loud warning.

### M3 — Adapter SDK + first adapter (OpenClaw)
- `adapter-sdk` with the interface (§3) + conformance harness.
- `adapter-openclaw`: implement `detect/plan/apply/export`.
- **Acceptance:** export a real/mock OpenClaw setup → pack → install into a clean sandbox OpenClaw config → conformance harness passes (no secrets, lossiness reported, idempotent).

### M4 — Second adapter (Hermes) + cross-framework proof
- `adapter-hermes` with bounded-memory prioritization + lossiness reporting.
- `cli install` full wizard (§4) including credential resolution + dry-run + memory preview.
- **Acceptance (THE headline demo):** take an exported OpenClaw bundle, `uniqent install --target hermes`, and the resulting Hermes agent loads persona, retains prioritized memory (with a truncation report), has its MCP servers registered, and runs. This is the milestone that proves the whole thesis.

### M5 — Claude Code adapter + examples
- `adapter-claude-code` (skills + persona + MCP; document memory caveats).
- Author 5 example bundles in `examples/` (dev-powerpack, research-analyst, founder, content-creator, personal-assistant) with real MCP wiring (e.g. GitHub MCP, filesystem MCP, a web-search MCP) and credential requirements (no secrets).
- **Acceptance:** each example installs cleanly into at least two targets; permission + credential prompts render correctly.

### M6 — Registry (open-core) + web one-click
- Minimal open registry: publish/search/install-by-slug; semver; compatibility badges; trust/signature status surfaced.
- `uniqent://install?bundle=<url>` protocol handler + web "Install" button that hands off to the local CLI/installer. **Must also work installing from a raw GitHub URL with no registry.**
- **Acceptance:** publish an example, find it via search, one-click install it end to end; same bundle installs from a raw URL without the registry running.

---

## 6. Security requirements (apply continuously, not just M2)
- Hard secret-scan gate on pack/validate/sign (fail closed).
- Static scan of skill scripts on `validate` (flag shell-outs, network calls, obfuscation) — warn in v1, block on registry publish later.
- Signature verify on install; loud unsigned warning.
- Permission sheet + memory preview always shown before any write.
- Sandboxed dry-run before `apply`.
- `SECURITY.md` with disclosure policy.

## 7. Definition of done for v1
- Spec public + versioned. CLI does init→pack→sign→verify→inspect→install→export.
- Three working adapters (OpenClaw, Hermes, Claude Code) passing the conformance harness.
- The M4 cross-framework demo reproducible from a single command sequence documented in README.
- 5 example bundles. Open registry MVP. Bundles installable from raw URL with zero hosted dependency.
- All non-negotiable principles (§0) hold; secret-scan gate proven by tests.

## 8. Explicitly out of scope for v1 (do not build yet)
- Paid marketplace / billing.
- Enterprise SSO / fleet install.
- Adapters beyond the three above (Codex, Cursor, Gemini come after v1).
- Dynamic persona "evolution" / runtime learning loops.
- GUI app (CLI + web install button only for v1).

---

## 9. First actions for Claude Code
1. Confirm Node 20+ and pnpm. Scaffold the monorepo + CI (M0).
2. Implement `packages/spec` (zod schema for §2) and generate JSON Schema + SPEC.md.
3. Build `core` + CLI `init/validate/pack/inspect` (M1) with the secret-scan gate and tests.
4. Open a PR per milestone. Stop at each acceptance gate and report results before continuing.
