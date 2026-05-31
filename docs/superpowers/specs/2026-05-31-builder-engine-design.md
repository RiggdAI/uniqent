# M2 — Builder Engine (`packages/builder`) Design

**Date:** 2026-05-31
**Status:** Approved (brainstorm) — pending implementation plan
**Milestone:** M2 (see `docs/BUILD_PLAN.md` §6)

## Purpose

`@uniqent/builder` is the framework-agnostic "assemble a brain" engine. It lets a caller build or
edit a brain through intent-level operations and emit a validated `@uniqent/core` `Bundle`. Both
the CLI and (the priority) **M3 Studio** are thin front-ends over it — the logic lives here once.
Headless and fully unit-tested so the UI rests on a proven core. Depends on `@uniqent/core` and
`@uniqent/spec`.

## Architecture — units

| Module              | Purpose                                                   | Key exports                                 |
| ------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `brain.ts`          | The editable in-memory model; assembles a `Bundle`.       | `Brain`                                     |
| `derive.ts`         | Pure derivation of `components` + baseline `permissions`. | `deriveComponents()`, `derivePermissions()` |
| `catalog/mcp.ts`    | Curated MCP server catalog.                               | `MCP_CATALOG`, `McpCatalogEntry`            |
| `catalog/skills.ts` | Curated starter skills.                                   | `SKILL_CATALOG`, `SkillCatalogEntry`        |
| `catalog/index.ts`  | Catalog re-exports.                                       | —                                           |
| `index.ts`          | Public re-exports.                                        | —                                           |

### `Brain`

Holds editable state: meta (`name/displayName/version/description/author/license/tags`), `targets`,
persona/policies markdown, memory profile, `facts[]`, `episodic[]`, `skills` (name → SKILL.md +
optional extra files), `mcp[]`, `tools[]`, `tasks[]`, `channels[]`, runtime config, `credentials[]`,
and an optional `permissions` override.

- Construction: `Brain.create(meta)`; `Brain.fromBundle(bundle)` (hydrate for editing).
- Editing: `setMeta`, `setTargets`, `setPersona`, `setPolicies`, `setProfile`, `addMemory`/`removeMemory`
  (routes by `kind`: `episodic` → episodic.jsonl, else facts.jsonl), `addSkill`/`removeSkill`,
  `addMcpServer`/`removeMcpServer`, `setTool`/`removeTool`, `addTask`/`removeTask`,
  `addChannel`/`removeChannel`, `setRuntime`, `addCredential`/`removeCredential`, `setPermissions`.
- Catalog helpers: `addMcpFromCatalog(id)` (adds the server + its credential requirement),
  `addSkillFromCatalog(name)`.
- Inputs are normalized through the spec schemas (e.g. `MemoryItem.parse`, `McpServer.parse`) so
  serialization is deterministic and `visibility`/other defaults are applied.
- `toBundle(): Bundle` — writes every component file, then a manifest whose `components`,
  `permissions`, and `credentials.consumedBy` are auto-derived (see below).
- `validate(): ValidationResult` — `core.validateBundle(this.toBundle())`; never throws, so a UI can
  show live errors.

### Auto-derivation (`derive.ts`)

- `deriveComponents(...)` — counts/name-lists from current contents.
- `derivePermissions(mcp, channels, runtime, override)` — baseline:
  - `network.endpoints`: hosts parsed from MCP `url`s (sorted, deduped).
  - `spawnsProcesses`: true if any MCP `transport === 'stdio'`.
  - `autonomy`: `override ?? runtime.autonomy ?? 'suggest'`.
  - `filesystem`: `override ?? { read: [], write: [] }` — never inferred.
  - Any field present in `override` wins (so `fromBundle` round-trips the stored permissions exactly).
- `credentials[].consumedBy` is synced in `Brain`: for each credential `ref`, add `mcp:<id>` /
  `channel:<id>` for every server/channel referencing it.

### Catalogs

Data-only, contributable later. Seed:

- MCP: `github` (streamable-http, bearer `github_pat` credential), `filesystem` (stdio, `npx`
  `@modelcontextprotocol/server-filesystem`), `fetch` (stdio, web fetch). Entry = `{ id, name,
description, server: McpServer, credential?: CredentialRequirement }`.
- Skills: `code-review`, `summarize`. Entry = `{ name, description, skillMd }`.

## Testing (TDD)

- Assemble a brain from scratch (meta + persona + memory + one catalog MCP + one catalog skill) →
  `toBundle()` then `validateBundle` is `ok` with 0 errors.
- `addMcpFromCatalog('github')` adds the server **and** the `github_pat` credential, and the manifest
  shows `consumedBy: ['mcp:github']`.
- `deriveComponents` reflects contents; `derivePermissions` sets `spawnsProcesses` for a stdio server
  and collects the MCP host into `network.endpoints`.
- Round-trip: `Brain.fromBundle(b.toBundle()).toBundle()` has the same `canonicalDigest` as
  `b.toBundle()` (digest-stable).
- `addMemory` routes `episodic` kind to episodic and others to facts.

## Acceptance (M2)

- A brain assembled programmatically (incl. from catalog) emits a `Bundle` that passes
  `validateBundle` with no secrets.
- Auto-derived `components`/`permissions`/`consumedBy` are correct.
- `fromBundle → toBundle` is digest-stable.
- `pnpm build`, `typecheck`, `lint`, `test` all pass.
