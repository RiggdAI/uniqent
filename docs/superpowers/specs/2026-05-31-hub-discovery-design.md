# Hub discovery (add MCP / skills from hubs) — design

**Goal:** Let a user discover and add MCP servers and skills from external hubs — the official MCP
Registry, Smithery, any hosted JSON index, and GitHub skill repos — without hand-writing config.
Each added item becomes a normal component node on the Studio canvas; the hub is the discovery
surface, not a new node type.

**Decisions (locked):** Hybrid approach; target all four hubs; expose in Studio **and** the CLI.

## Architecture

A `CatalogSource` abstraction lives in **`packages/builder`** (built once; Studio and CLI are thin
front-ends, per repo rules). Sources fan out behind two aggregators with per-source error isolation
(one hub being down or rate-limited never fails the whole search).

```ts
// Normalized results reuse existing shapes so they plug into the builder unchanged.
interface McpHubResult {
  source: string; // 'mcp-registry' | 'smithery' | 'json-index'
  entry: McpCatalogEntry; // { id, name, description, server: McpServer, credential? }
  homepage?: string;
  popularity?: number; // useCount/score where the hub provides it
}
interface SkillHubResult {
  source: string; // 'github' | 'json-index'
  name: string;
  description: string;
  skillUrl?: string; // raw SKILL.md to import (may be a best-effort guess)
  repo?: string;
  stars?: number;
}
interface CatalogSource {
  id: string;
  label: string;
  searchMcp?(query: string, signal?: AbortSignal): Promise<McpHubResult[]>;
  searchSkills?(query: string, signal?: AbortSignal): Promise<SkillHubResult[]>;
}

async function searchMcpHubs(query, sources): Promise<McpHubResult[]>; // Promise.allSettled, flatten
async function searchSkillHubs(query, sources): Promise<SkillHubResult[]>;
```

Adding a result reuses what exists: an `McpHubResult.entry` goes through the same path as
`addCustomMcp` (+ its `credential`); a `SkillHubResult.skillUrl` goes through `importSkillFromUrl`.

## Sources (verified against the live APIs, 2026-05-31)

### 1. Official MCP Registry — `mcp-registry` (no auth)

`GET https://registry.modelcontextprotocol.io/v0/servers?search=<q>&limit=<n>` →
`{ servers: [{ server: {...}, _meta }], metadata: { nextCursor, count } }`.
Map `server` → `McpServer`:

- `remotes:[{type,url}]` present → `transport: 'streamable-http'` (or `'sse'`), `url = remotes[0].url`,
  `auth: { type:'none' }` (registry doesn't declare remote auth; user adds creds later if needed).
- else first `packages[]` → `transport: 'stdio'`, `command = runtimeHint` (e.g. `npx`/`uvx`),
  `args = [...runtimeArguments.value, identifier]`, and `environmentVariables[]`:
  - `isSecret` → `env[NAME] = '${credentialRef:<slug>_<name>}'` + emit a `CredentialRequirement`.
  - non-secret → `env[NAME] = default ?? ''` (a config value, not a credential).
- `id` = slugified `name` (e.g. `com.pulsemcp/remote-filesystem` → `com-pulsemcp-remote-filesystem`).
- Only keep `_meta…isLatest === true` rows.

### 2. Smithery — `smithery` (no auth for listing)

`GET https://registry.smithery.ai/servers?q=<q>` → `{ servers: [{ qualifiedName, displayName,
description, useCount, homepage }] }`. Map → remote MCP at
`https://server.smithery.ai/<qualifiedName>/mcp`, `transport:'streamable-http'`,
`auth:{ type:'bearer', credentialRef:'smithery_api_key' }` + a shared `smithery_api_key` credential
(help → smithery.ai/account/api-keys). `popularity = useCount`.

### 3. Generic JSON index — `json-index` (no service)

`GET <url>` → `{ mcp?: McpCatalogEntry[], skills?: SkillHubResult[] }`. The same "a hub is just a
hosted JSON file" pattern as the bundle registry. Lets a team point at their own curated list.

### 4. GitHub skills — `github` (optional token)

`GET https://api.github.com/search/repositories?q=<q>` → repos. Surface candidates with
`skillUrl = https://raw.githubusercontent.com/<full_name>/HEAD/SKILL.md` (best-effort guess);
import via the existing URL path, which fails gracefully if the repo lays SKILL.md out differently
(the user can then paste the exact raw URL). Unauthenticated search is rate-limited (~10/min); an
optional `GITHUB_TOKEN` raises it. **Honest limitation: skills hubs are immature, so this is
repo-search + a guessed path, not a rich skills API.**

## Surfaces

- **CLI:** `uniqent hub mcp <query> [--source ...] [--json]` and `uniqent hub skills <query>`. A
  follow-up `--add` writes into a brain dir is out of scope for v1 (CLI is discovery; Studio adds).
- **Studio:** palette "Browse hubs" tab → debounced search across sources → result cards with
  source badge + popularity → click adds the node (MCP entry or skill import). New API routes
  `/api/hub/mcp` and `/api/hub/skills` over the builder aggregators. The local server already
  guards to 127.0.0.1; outbound hub fetches happen server-side.

## Testing

No test depends on a live API. Each mapper is unit-tested against a **frozen fixture** of the real
response captured today; the aggregator is tested for error isolation (one source throws → results
from the others still return). Live calls are exercised only by an opt-in manual smoke script.

## Milestones

- **H1** — `CatalogSource` types + aggregators + **MCP Registry source** + JSON-index source + fixtures/tests (builder).
- **H2** — Smithery source + GitHub skills source + tests.
- **H3** — CLI `hub` commands over the aggregators.
- **H4** — Studio palette "Browse hubs" tab + API routes.
