# Add any MCP — paste, search, surface

**Date:** 2026-06-10
**Goal:** Let a user add *any* MCP server they can find — not just the 5 curated catalog
quick-picks — and package it into a brain, with secrets always lifted to credential
*requirements* so the fail-closed secret gate stays intact. No new command, no new runtime:
this is purely the **builder** primitive + **Studio** UI.

## Background — what already exists

The builder is **not** limited to the fixed catalog today. There are four add paths:

1. **Catalog quick-picks** — `MCP_CATALOG` (github, filesystem, fetch, gbrain ×2).
2. **Custom** — `brain.addMcpServer(server)` / Studio `POST /api/mcp/custom` (any canonical object).
3. **Import** — `session.importMcpServers` / `POST /api/mcp/import` (list of canonical servers).
4. **Hub search** — `searchMcpHubs` across **MCP Registry + Smithery + JSON-index**;
   `POST /api/hub/mcp/search` + `/api/hub/mcp/add`.

The real gaps: (a) import/custom expect Uniqent's **canonical** `McpServer` shape, but "any MCP
you find" is shared as the **standard `mcpServers` config blob** (Claude Desktop / `.mcp.json` /
Cursor) with secrets sitting raw in `env` — which our secret-scan gate would (correctly) reject;
(b) the most common place to "find an MCP" is a **GitHub repo**, not a registry; (c) the existing
paths are backend-only and not surfaced for non-technical Studio users.

## Part 1 — `normalizeMcpConfig()` (the keystone primitive)

New pure function: `packages/builder/src/mcp/normalize.ts`. Reused by Parts 2 and 3.

**Input (auto-detected):**
- The universal `{ "mcpServers": { "<name>": { command, args, env } | { url, headers } } }` blob.
- A single server object `{ command, args, env }` or `{ url, headers }`.
- An already-canonical `McpServer` (pass-through).

**Output:** `{ servers: McpServer[]; credentials: CredentialRequirement[]; lossiness: string[] }`

**Logic:**
- `id = slugifyId(name)` (reuse `hubs/types.ts`).
- `command` + `args` → `transport: 'stdio'`. `url` (+ `headers`) → `transport: 'streamable-http'`
  (`'sse'` if the url path hints sse).
- **Secret lifting (the key bit):** for each `env` var (stdio) and each `header` (remote), treat
  it as secret when its **name** matches `/(KEY|TOKEN|SECRET|PASSWORD|PAT|AUTH|APIKEY|ACCESS)/i`
  **or** its **value** trips `scanForSecrets` (imported from `@uniqent/core`). A secret value is
  replaced with `${credentialRef:<id>_<name-lowercased>}` and a
  `CredentialRequirement{ ref, label:<name>, type:'apiKey', consumedBy:['mcp:<id>'], required:true }`
  is emitted. A `Authorization: Bearer <x>` header becomes `auth:{ type:'bearer', credentialRef }`.
  Non-secret env/headers stay inline.
- Defaults: `auth:{ type:'none' }`, `tools:{ include:'all' }`.
- **Never throws.** Unrecognized shape → `{ servers: [], credentials: [], lossiness: ['unrecognized MCP config format'] }`.
  Anything dropped or guessed is pushed to `lossiness`.

**Reuse:** replaces the ad-hoc `{ tools:{include:'all'}, ...raw }` spread in
`session.importMcpServers`. The registry mapper (`hubs/mcp-registry.ts`) keeps its own lifting
(it has richer `isSecret` metadata) but converges on the same `CredentialRequirement` shape.

**Why this matters:** a pasted config containing a raw `sk-...` now packs cleanly — the secret
becomes a ref and never travels in the bundle. This is the line that makes "add any MCP" obey the
non-negotiable "secrets never travel" principle.

## Part 2 — GitHub MCP discovery source

New `packages/builder/src/hubs/github-mcp.ts`, mirroring `github-skills.ts`:

- `CatalogSource.searchMcp(query)` → GitHub repo search `"<query> mcp server"`, `sort=stars`,
  token-aware (`GITHUB_TOKEN` raises the rate limit). Each repo → `McpHubResult` carrying a
  best-effort stdio **guess** server (`npx -y <repo-name>`), `source:'github'`, `homepage`, stars
  as `popularity`.
- **On add** (in the session): fetch the repo `README.md` (`HEAD/README.md`) and run
  `normalizeMcpConfig` on it to extract a real `mcpServers` block if one is present; use that when
  found, otherwise keep the guess and report lossiness ("couldn't auto-detect run config — edit the
  command before install"). README fetch failure → fall back to the guess + lossiness, never throw.
- Registered in `hubs/defaults.ts` next to mcp-registry + smithery.

## Part 3 — Studio palette: one "Add MCP" with three modes

The MCP add panel becomes a single entry point with three modes:

- **Search** — the existing hub fan-out, now including GitHub.
- **Paste config** — a textarea posting to a new `POST /api/mcp/paste` that runs
  `normalizeMcpConfig` and returns a **preview**: the normalized server(s) **and the lifted
  credential fields** (e.g. "needs `BRAVE_API_KEY`"), so a non-technical user sees the requirements
  up front before adding. Confirm → `addMcpServer` + `addCredential`.
- **From catalog** — the existing quick-picks.

Keep `/api/mcp/custom` for the advanced single-object form. New route `POST /api/mcp/paste` is a
thin preview wrapper over the normalizer (no brain mutation until confirm).

**Data flow:** paste / README → `normalizeMcpConfig` → `McpServer[]` + `CredentialRequirement[]`
→ `brain.addMcpServer` + `brain.addCredential` → bundle. Secret gate fail-closed throughout.

## Testing

- `packages/builder/test/mcp-normalize.test.ts`: Claude-Desktop blob · single stdio · single
  remote · bearer header → `auth.bearer` · secret lifting by **name** · secret lifting by
  **value** (`scanForSecrets`) · non-secret env kept inline · already-canonical pass-through ·
  **pasted blob with a raw secret → refs → `pack()` succeeds** (the gate-passes proof).
- `packages/builder/test/github-mcp.test.ts`: frozen GitHub search fixture → repos mapped;
  README-extract path produces a normalized server via the primitive.
- Studio: `/api/mcp/paste` preview route smoke test (returns servers + credentials, mutates
  nothing).

## Error handling

- Normalizer never throws — unknown shape returns empty servers + a lossiness note.
- Hub sources throw on transport failure; the aggregator isolates per-source (existing behavior).
- GitHub README fetch failure on add → fall back to the stdio guess + lossiness.

## Out of scope (YAGNI)

- Additional third-party registries (PulseMCP/Glama/mcp.so) — GitHub + the official registry +
  Smithery cover discovery; more sources are brittle mappers we can add later if needed.
- Editing an MCP's tool include/exclude list in the paste preview — added via the normal inspector.
- CLI surface for paste (the CLI already imports canonical JSON); paste is a Studio-first,
  non-technical-user affordance.
