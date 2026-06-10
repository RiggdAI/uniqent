# Add any MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add *any* MCP server they find — by pasting the standard `mcpServers` config blob, by searching GitHub, or via the existing hubs/catalog — and package it, with secrets always lifted to credential *requirements* so the fail-closed secret gate stays intact.

**Architecture:** A new pure builder primitive `normalizeMcpConfig()` converts any common MCP config shape into canonical `McpServer[]` + `CredentialRequirement[]`, lifting secret env/headers to `${credentialRef:…}`. A new GitHub MCP discovery source reuses it on repo READMEs. Studio's "Custom / import" panel gains a "Paste config" mode over a new preview route. No new command, no new runtime.

**Tech Stack:** TypeScript ESM, zod (`@uniqent/spec`), `@uniqent/core` (secret detection), vitest, React (Studio web).

Spec: `docs/superpowers/specs/2026-06-10-add-any-mcp-design.md`.

---

## File Structure

- **Create** `packages/core/src/secret-scan.ts` — export a value-level `isLikelySecretValue` (reuse existing `detect`).
- **Create** `packages/builder/src/mcp/normalize.ts` — `normalizeMcpConfig()` keystone primitive.
- **Create** `packages/builder/test/mcp-normalize.test.ts` — primitive tests incl. gate-passes proof.
- **Create** `packages/builder/src/hubs/github-mcp.ts` — GitHub MCP discovery source + README extraction.
- **Create** `packages/builder/test/github-mcp.test.ts` — frozen-fixture mapping + README extract.
- **Modify** `packages/builder/src/hubs/defaults.ts` — register the GitHub MCP source.
- **Modify** `packages/builder/src/index.ts` — export `./mcp/normalize.js`.
- **Modify** `apps/studio/src/server/session.ts` — use the normalizer in import/paste; add `previewPastedMcp` + `addPastedMcp`.
- **Modify** `apps/studio/src/server/api.ts` — `POST /api/mcp/paste` (preview) + `/api/mcp/paste/add`.
- **Modify** `apps/studio/web/src/api.ts` + `types.ts` — client `pasteMcp`/`addPastedMcp` + `McpNormalizePreview`.
- **Modify** `apps/studio/web/src/Inspector.tsx` — add "Paste config" mode to `CustomMcpEditor`.
- **Create** `apps/studio/test/paste-mcp.test.ts` — server route smoke test.

---

## Task 1: Core — value-level secret detector

**Files:**
- Modify: `packages/core/src/secret-scan.ts`
- Test: `packages/core/test/secret-scan.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/secret-scan.test.ts`:

```ts
import { isLikelySecretValue } from '../src/secret-scan.js';

describe('isLikelySecretValue', () => {
  it('flags known-prefix and high-entropy values', () => {
    expect(isLikelySecretValue('sk-abcdefghijklmnopqrstuvwxyz0123')).toBe(true);
    expect(isLikelySecretValue('ghp_0123456789abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(isLikelySecretValue('kJ8s0LkQ2mZ9rT4wX7bV1nC6pY3dF5gH8jL0aS2')).toBe(true);
  });
  it('does not flag placeholders or plain text', () => {
    expect(isLikelySecretValue('${credentialRef:foo_token}')).toBe(false);
    expect(isLikelySecretValue('hello world')).toBe(false);
    expect(isLikelySecretValue('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`isLikelySecretValue` not exported)

Run: `pnpm vitest run packages/core/test/secret-scan.test.ts -t "isLikelySecretValue"`
Expected: FAIL — "isLikelySecretValue is not a function".

- [ ] **Step 3: Implement** — at the end of `packages/core/src/secret-scan.ts`, add:

```ts
/** True when a single string value looks like a secret (known prefix or high entropy). */
export function isLikelySecretValue(value: string): boolean {
  return detect(value) !== null;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm vitest run packages/core/test/secret-scan.test.ts -t "isLikelySecretValue"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/secret-scan.ts packages/core/test/secret-scan.test.ts
git commit -m "feat(core): export value-level isLikelySecretValue"
```

---

## Task 2: Builder — `normalizeMcpConfig()` primitive

**Files:**
- Create: `packages/builder/src/mcp/normalize.ts`
- Modify: `packages/builder/src/index.ts`
- Test: `packages/builder/test/mcp-normalize.test.ts`

Canonical facts (from `packages/spec/src/mcp.ts`): `McpServer` has `id, transport, url?, command?, args?, env?(record<string>), auth{type,credentialRef?,headerName?}, tools{include}, description?`. **There is no `headers` field** — remote auth is expressed via `auth`. So pasted `headers` must be converted to `auth` (bearer/header) + a credential; extra secret headers beyond the first go to `lossiness`.

- [ ] **Step 1: Write the failing test** — `packages/builder/test/mcp-normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Bundle, pack } from '@uniqent/core';
import { normalizeMcpConfig } from '../src/mcp/normalize.js';

describe('normalizeMcpConfig', () => {
  it('normalizes a Claude-Desktop mcpServers blob (stdio + secret env)', () => {
    const r = normalizeMcpConfig({
      mcpServers: {
        'brave-search': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: { BRAVE_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123', LANG: 'en' },
        },
      },
    });
    expect(r.servers).toHaveLength(1);
    const s = r.servers[0]!;
    expect(s.id).toBe('brave-search');
    expect(s.transport).toBe('stdio');
    expect(s.command).toBe('npx');
    expect(s.env!.BRAVE_API_KEY).toBe('${credentialRef:brave-search_brave_api_key}');
    expect(s.env!.LANG).toBe('en'); // non-secret kept inline
    const cred = r.credentials.find((c) => c.ref === 'brave-search_brave_api_key')!;
    expect(cred.consumedBy).toContain('mcp:brave-search');
    expect(cred.required).toBe(true);
  });

  it('lifts a secret env var by NAME even when value is not high-entropy', () => {
    const r = normalizeMcpConfig({
      mcpServers: { x: { command: 'run', env: { API_TOKEN: 'short' } } },
    });
    expect(r.servers[0]!.env!.API_TOKEN).toBe('${credentialRef:x_api_token}');
    expect(r.credentials).toHaveLength(1);
  });

  it('maps a remote server with a Bearer header to auth.bearer + a credential', () => {
    const r = normalizeMcpConfig({
      mcpServers: {
        linear: { url: 'https://mcp.linear.app/sse', headers: { Authorization: 'Bearer xyz' } },
      },
    });
    const s = r.servers[0]!;
    expect(s.transport).toBe('sse');
    expect(s.auth).toEqual({ type: 'bearer', credentialRef: 'linear_token' });
    expect(r.credentials[0]!.ref).toBe('linear_token');
  });

  it('maps a non-Authorization secret header to auth.header + headerName', () => {
    const r = normalizeMcpConfig({
      mcpServers: { svc: { url: 'https://api.x.com/mcp', headers: { 'X-API-Key': 'abc' } } },
    });
    const s = r.servers[0]!;
    expect(s.transport).toBe('streamable-http');
    expect(s.auth).toEqual({ type: 'header', headerName: 'X-API-Key', credentialRef: 'svc_x_api_key' });
  });

  it('passes through an already-canonical McpServer', () => {
    const canonical = {
      id: 'gh', transport: 'stdio', command: 'npx', args: ['-y', 'x'],
      auth: { type: 'none' }, tools: { include: 'all' },
    };
    const r = normalizeMcpConfig(canonical);
    expect(r.servers[0]!.id).toBe('gh');
    expect(r.lossiness).toEqual([]);
  });

  it('returns a lossiness note for an unrecognized shape, never throws', () => {
    const r = normalizeMcpConfig({ totally: 'unrelated' });
    expect(r.servers).toEqual([]);
    expect(r.lossiness.length).toBeGreaterThan(0);
  });

  it('a pasted blob with a RAW secret packs cleanly (gate passes)', async () => {
    const r = normalizeMcpConfig({
      mcpServers: { x: { command: 'run', env: { OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123' } } },
    });
    const bundle = new Bundle();
    bundle.set('uniqent.json', new TextEncoder().encode(JSON.stringify({ schemaVersion: '1.0.0' })));
    bundle.set('mcp/servers.json', new TextEncoder().encode(JSON.stringify({ servers: r.servers })));
    await expect(pack(bundle)).resolves.toBeInstanceOf(Uint8Array); // no secret leaked → gate OK
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing)

Run: `pnpm vitest run packages/builder/test/mcp-normalize.test.ts`
Expected: FAIL — cannot find `../src/mcp/normalize.js`.

- [ ] **Step 3: Implement** — `packages/builder/src/mcp/normalize.ts`:

```ts
import type { McpServer, CredentialRequirement } from '@uniqent/spec';
import { McpServer as McpServerSchema } from '@uniqent/spec';
import { isLikelySecretValue } from '@uniqent/core';
import { slugifyId } from '../hubs/types.js';

export interface NormalizeResult {
  servers: McpServer[];
  credentials: CredentialRequirement[];
  lossiness: string[];
}

const SECRET_NAME_RE = /(KEY|TOKEN|SECRET|PASSWORD|PASS|PAT|AUTH|APIKEY|ACCESS|CREDENTIAL)/i;
const isSecretName = (name: string): boolean => SECRET_NAME_RE.test(name);

/** A single raw server entry as found in the wild (mcpServers map value or a bare object). */
interface RawServer {
  id?: string;
  transport?: string;
  url?: string;
  command?: string;
  args?: unknown;
  env?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  auth?: unknown;
  tools?: unknown;
  description?: string;
}

function credFor(ref: string, label: string, id: string): CredentialRequirement {
  return { ref, label, type: 'apiKey', consumedBy: [`mcp:${id}`], required: true };
}

/** Convert one raw server to canonical + its lifted credentials. */
function mapOne(id: string, raw: RawServer, out: NormalizeResult): void {
  const creds: CredentialRequirement[] = [];
  const description = typeof raw.description === 'string' ? raw.description : undefined;
  const isRemote = !!raw.url && !raw.command;

  if (isRemote) {
    const transport = /sse(\b|$|\/)/.test(raw.url!) || raw.transport === 'sse' ? 'sse' : 'streamable-http';
    let auth: McpServer['auth'] = { type: 'none' };
    const headers = (raw.headers ?? {}) as Record<string, unknown>;
    const secretHeaders = Object.entries(headers).filter(
      ([k, v]) => typeof v === 'string' && (isSecretName(k) || isLikelySecretValue(v)),
    );
    if (secretHeaders.length > 0) {
      const [hName] = secretHeaders[0]!;
      if (/^authorization$/i.test(hName)) {
        const ref = `${id}_token`;
        auth = { type: 'bearer', credentialRef: ref };
        creds.push(credFor(ref, hName, id));
      } else {
        const ref = `${id}_${hName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
        auth = { type: 'header', headerName: hName, credentialRef: ref };
        creds.push(credFor(ref, hName, id));
      }
      if (secretHeaders.length > 1) {
        out.lossiness.push(`${id}: only the first auth header is kept; dropped ${secretHeaders.slice(1).map(([k]) => k).join(', ')}`);
      }
    }
    const server = {
      id, transport, url: raw.url, auth, tools: { include: 'all' as const },
      ...(description ? { description } : {}),
    };
    pushValidated(server, creds, out);
    return;
  }

  // stdio
  const args = Array.isArray(raw.args) ? raw.args.filter((a): a is string => typeof a === 'string') : [];
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.env ?? {})) {
    if (typeof v !== 'string') continue;
    if (isSecretName(k) || isLikelySecretValue(v)) {
      const ref = `${id}_${k.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
      env[k] = `\${credentialRef:${ref}}`;
      creds.push(credFor(ref, k, id));
    } else {
      env[k] = v;
    }
  }
  const server = {
    id, transport: 'stdio', command: raw.command ?? 'npx',
    ...(args.length ? { args } : {}),
    ...(Object.keys(env).length ? { env } : {}),
    auth: { type: 'none' as const }, tools: { include: 'all' as const },
    ...(description ? { description } : {}),
  };
  pushValidated(server, creds, out);
}

function pushValidated(server: unknown, creds: CredentialRequirement[], out: NormalizeResult): void {
  const parsed = McpServerSchema.safeParse(server);
  if (!parsed.success) {
    out.lossiness.push(`skipped a server: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    return;
  }
  out.servers.push(parsed.data);
  out.credentials.push(...creds);
}

/**
 * Normalize any common MCP config shape to canonical servers + lifted credentials.
 * Accepts: a `{ mcpServers: { name: {...} } }` blob, a single raw/canonical server object,
 * or a `{ servers: [...] }` list. Never throws — unknown shapes return a lossiness note.
 */
export function normalizeMcpConfig(input: unknown): NormalizeResult {
  const out: NormalizeResult = { servers: [], credentials: [], lossiness: [] };
  if (!input || typeof input !== 'object') {
    out.lossiness.push('unrecognized MCP config format');
    return out;
  }
  const obj = input as Record<string, unknown>;

  // Already-canonical (or near) single server: has id + transport.
  if (typeof obj.id === 'string' && typeof obj.transport === 'string') {
    const canonical = McpServerSchema.safeParse({ tools: { include: 'all' }, ...obj });
    if (canonical.success) { out.servers.push(canonical.data); return out; }
  }

  if (obj.mcpServers && typeof obj.mcpServers === 'object') {
    for (const [name, raw] of Object.entries(obj.mcpServers as Record<string, RawServer>)) {
      mapOne(slugifyId(name), raw ?? {}, out);
    }
    return out;
  }
  if (Array.isArray(obj.servers)) {
    for (const raw of obj.servers as RawServer[]) {
      const id = typeof raw.id === 'string' && raw.id ? slugifyId(raw.id) : 'mcp-server';
      mapOne(id, raw, out);
    }
    return out;
  }
  // A bare single raw server (command or url present).
  if (typeof obj.command === 'string' || typeof obj.url === 'string') {
    const id = typeof obj.id === 'string' && obj.id ? slugifyId(obj.id) : 'mcp-server';
    mapOne(id, obj as RawServer, out);
    return out;
  }

  out.lossiness.push('unrecognized MCP config format');
  return out;
}
```

- [ ] **Step 4: Export it** — add to `packages/builder/src/index.ts`:

```ts
export * from './mcp/normalize.js';
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm vitest run packages/builder/test/mcp-normalize.test.ts`
Expected: PASS (all 7).

- [ ] **Step 6: Commit**

```bash
git add packages/builder/src/mcp/normalize.ts packages/builder/test/mcp-normalize.test.ts packages/builder/src/index.ts
git commit -m "feat(builder): normalizeMcpConfig — accept any MCP config, lift secrets to refs"
```

---

## Task 3: Builder — GitHub MCP discovery source

**Files:**
- Create: `packages/builder/src/hubs/github-mcp.ts`
- Modify: `packages/builder/src/hubs/defaults.ts`, `packages/builder/src/hubs/index.ts`
- Test: `packages/builder/test/github-mcp.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/builder/test/github-mcp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapGithubMcpRepo, extractMcpFromReadme } from '../src/hubs/github-mcp.js';

const FIXTURE = {
  items: [
    { full_name: 'acme/cool-mcp', html_url: 'https://github.com/acme/cool-mcp',
      description: 'A cool MCP server', stargazers_count: 42 },
    { full_name: 'no/name-stripped' },
  ],
};

describe('github-mcp source', () => {
  it('maps repos to McpHubResult with a best-effort stdio guess', () => {
    const results = FIXTURE.items.map(mapGithubMcpRepo).filter(Boolean);
    expect(results).toHaveLength(2);
    const r = results[0]!;
    expect(r.source).toBe('github');
    expect(r.entry.id).toBe('cool-mcp');
    expect(r.entry.server.transport).toBe('stdio');
    expect(r.popularity).toBe(42);
  });

  it('extracts a real mcpServers block from a README via the normalizer', () => {
    const readme = [
      '# Cool MCP', 'Install:', '```json',
      '{ "mcpServers": { "cool": { "command": "npx", "args": ["-y", "cool-mcp"],',
      '  "env": { "COOL_API_KEY": "sk-abcdefghijklmnopqrstuvwxyz0123" } } } }',
      '```',
    ].join('\n');
    const r = extractMcpFromReadme('cool-mcp', readme);
    expect(r).not.toBeNull();
    expect(r!.entry.server.command).toBe('npx');
    expect(r!.credentials.some((c) => c.ref.includes('cool_api_key') || c.ref.includes('api_key'))).toBe(true);
  });

  it('returns null when the README has no config block', () => {
    expect(extractMcpFromReadme('x', '# Just prose, no code')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (module missing)

Run: `pnpm vitest run packages/builder/test/github-mcp.test.ts`
Expected: FAIL — cannot find `../src/hubs/github-mcp.js`.

- [ ] **Step 3: Implement** — `packages/builder/src/hubs/github-mcp.ts`:

```ts
import type { CatalogSource, McpHubResult } from './types.js';
import { slugifyId } from './types.js';
import { normalizeMcpConfig } from '../mcp/normalize.js';

const ENDPOINT = 'https://api.github.com/search/repositories';

interface GithubRepo {
  full_name?: string;
  html_url?: string;
  description?: string;
  stargazers_count?: number;
}
interface GithubSearchResponse { items?: GithubRepo[] }

/** Map a repo to a hub result with a best-effort `npx -y <repo>` guess (refined on add). */
export function mapGithubMcpRepo(repo: GithubRepo): McpHubResult | null {
  if (!repo.full_name) return null;
  const name = repo.full_name.split('/').pop() ?? repo.full_name;
  const id = slugifyId(name);
  return {
    source: 'github',
    entry: {
      id, name, description: repo.description ?? '',
      server: {
        id, transport: 'stdio', command: 'npx', args: ['-y', name],
        auth: { type: 'none' }, tools: { include: 'all' },
        description: repo.description ?? `${repo.full_name} (GitHub) — verify the run command`,
      },
    },
    credentials: [],
    ...(repo.html_url ? { homepage: repo.html_url } : {}),
    ...(typeof repo.stargazers_count === 'number' ? { popularity: repo.stargazers_count } : {}),
  };
}

export function mapGithubMcpResponse(json: unknown): McpHubResult[] {
  const items = (json as GithubSearchResponse)?.items ?? [];
  const out: McpHubResult[] = [];
  for (const item of items) {
    const m = mapGithubMcpRepo(item);
    if (m) out.push(m);
  }
  return out;
}

/** Pull the first ```json/```... mcpServers block out of a README and normalize it. */
export function extractMcpFromReadme(id: string, readme: string): McpHubResult | null {
  const blocks = [...readme.matchAll(/```(?:json[c]?)?\s*([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  for (const block of blocks) {
    if (!/mcpServers/.test(block)) continue;
    try {
      const parsed = JSON.parse(block.trim());
      const r = normalizeMcpConfig(parsed);
      if (r.servers.length > 0) {
        const server = r.servers[0]!;
        return {
          source: 'github',
          entry: { id: server.id, name: server.id, description: server.description ?? '', server,
            ...(r.credentials[0] ? { credential: r.credentials[0] } : {}) },
          credentials: r.credentials,
        };
      }
    } catch { /* try the next block */ }
  }
  return null;
}

export interface GithubMcpOptions { endpoint?: string; perPage?: number; token?: string }

/** Discover MCP servers as GitHub repos. Repo search now; run-config refined from the README on add. */
export function githubMcpSource(opts: GithubMcpOptions = {}): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  const perPage = opts.perPage ?? 20;
  return {
    id: 'github',
    label: 'GitHub',
    async searchMcp(query: string, signal?: AbortSignal): Promise<McpHubResult[]> {
      const q = `${query} mcp server`.trim();
      const url = `${endpoint}?q=${encodeURIComponent(q)}&per_page=${perPage}&sort=stars`;
      const token = opts.token ?? process.env.GITHUB_TOKEN;
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`);
      return mapGithubMcpResponse(await res.json());
    },
  };
}
```

- [ ] **Step 4: Register + export** — in `packages/builder/src/hubs/defaults.ts`, import and add to `defaultMcpSources`:

```ts
import { githubMcpSource } from './github-mcp.js';
// ...inside defaultMcpSources return array, after smitherySource():
    githubMcpSource(opts.githubToken ? { token: opts.githubToken } : {}),
```

And add to `packages/builder/src/hubs/index.ts`:

```ts
export * from './github-mcp.js';
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm vitest run packages/builder/test/github-mcp.test.ts`
Expected: PASS (all 3).

- [ ] **Step 6: Commit**

```bash
git add packages/builder/src/hubs/github-mcp.ts packages/builder/src/hubs/defaults.ts packages/builder/src/hubs/index.ts packages/builder/test/github-mcp.test.ts
git commit -m "feat(builder): GitHub MCP discovery source (README run-config extraction)"
```

---

## Task 4: Studio server — paste routes + normalizer-backed import

**Files:**
- Modify: `apps/studio/src/server/session.ts`
- Modify: `apps/studio/src/server/api.ts`
- Test: `apps/studio/test/paste-mcp.test.ts`

- [ ] **Step 1: Write the failing test** — `apps/studio/test/paste-mcp.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { StudioSession } from '../src/server/session.js';

const BLOB = JSON.stringify({
  mcpServers: { brave: { command: 'npx', args: ['-y', 'brave'], env: { BRAVE_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123' } } },
});

describe('paste MCP', () => {
  it('previewPastedMcp returns servers + lifted credentials, mutates nothing', () => {
    const s = new StudioSession();
    const preview = s.previewPastedMcp(BLOB);
    expect(preview.servers[0]!.id).toBe('brave');
    expect(preview.credentials[0]!.consumedBy).toContain('mcp:brave');
    expect(s.state().manifest.components.mcp).not.toContain('brave'); // no mutation
  });

  it('addPastedMcp adds the server + credential to the brain', () => {
    const s = new StudioSession();
    s.setPersona('x'); // make brain assemblable
    s.addPastedMcp(BLOB);
    expect(s.state().manifest.components.mcp).toContain('brave');
    expect(s.state().manifest.credentials.some((c) => c.ref === 'brave_brave_api_key')).toBe(true);
  });
});
```

(If `StudioSession` has no `setPersona`, drop that line — adding MCP does not require persona for `state()`.)

- [ ] **Step 2: Run it — expect FAIL** (`previewPastedMcp` missing)

Run: `pnpm vitest run apps/studio/test/paste-mcp.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement session methods** — in `apps/studio/src/server/session.ts`, import the normalizer at top:

```ts
import { normalizeMcpConfig, type NormalizeResult } from '@uniqent/builder';
```

Replace the body of `importMcpServers` and add the two paste methods:

```ts
  /** Bulk-import MCP servers from any shape (canonical list OR a config blob). */
  importMcpServers(servers: Array<Record<string, unknown>>): number {
    let n = 0;
    for (const raw of servers) {
      const r = normalizeMcpConfig(raw);
      for (const s of r.servers) { this.brain.addMcpServer(s); n++; }
      for (const c of r.credentials) this.brain.addCredential(c);
    }
    return n;
  }

  /** Preview a pasted MCP config without mutating the brain. */
  previewPastedMcp(text: string): NormalizeResult {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { return { servers: [], credentials: [], lossiness: ['not valid JSON'] }; }
    return normalizeMcpConfig(parsed);
  }

  /** Add a pasted MCP config (re-normalized server-side; secrets become refs). */
  addPastedMcp(text: string): number {
    const r = this.previewPastedMcp(text);
    for (const s of r.servers) this.brain.addMcpServer(s);
    for (const c of r.credentials) this.brain.addCredential(c);
    return r.servers.length;
  }
```

- [ ] **Step 4: Add routes** — in `apps/studio/src/server/api.ts`, after the `/api/mcp/import` block (line ~198):

```ts
  if (method === 'POST' && path === '/api/mcp/paste') {
    if (typeof b.text !== 'string') return fail(400, 'text is required');
    return ok(session.previewPastedMcp(b.text));
  }
  if (method === 'POST' && path === '/api/mcp/paste/add') {
    if (typeof b.text !== 'string') return fail(400, 'text is required');
    try {
      session.addPastedMcp(b.text);
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }
```

- [ ] **Step 5: Run it — expect PASS**

Run: `pnpm vitest run apps/studio/test/paste-mcp.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/server/session.ts apps/studio/src/server/api.ts apps/studio/test/paste-mcp.test.ts
git commit -m "feat(studio): paste-any-MCP routes + normalizer-backed import"
```

---

## Task 5: Studio client — "Paste config" mode

**Files:**
- Modify: `apps/studio/web/src/api.ts`
- Modify: `apps/studio/web/src/types.ts`
- Modify: `apps/studio/web/src/Inspector.tsx`

- [ ] **Step 1: Add the client types** — in `apps/studio/web/src/types.ts`, after `McpHubResult`:

```ts
export interface McpNormalizePreview {
  servers: Array<{ id: string; transport: string; command?: string; url?: string }>;
  credentials: CredentialRequirement[];
  lossiness: string[];
}
```

- [ ] **Step 2: Add the client API methods** — in `apps/studio/web/src/api.ts`, after `importMcpServers`:

```ts
  pasteMcpPreview: (text: string) => post<McpNormalizePreview>('/api/mcp/paste', { text }),
  addPastedMcp: (text: string) => post<StudioState>('/api/mcp/paste/add', { text }),
```

Add `McpNormalizePreview` to the type import at the top of `api.ts`.

- [ ] **Step 3: Add the "Paste config" UI** — in `apps/studio/web/src/Inspector.tsx`, inside `CustomMcpEditor`, add a paste textarea + preview above the existing form. Add state and a block at the top of the returned JSX (after the intro `<p>`):

```tsx
  const [paste, setPaste] = useState('');
  const [preview, setPreview] = useState<McpNormalizePreview | null>(null);
```

```tsx
      <div className="space-y-1.5 rounded-md border border-border p-3">
        <Label>Paste an MCP config</Label>
        <p className="text-xs text-muted-foreground">
          Drop the <code>mcpServers</code> block from any README. Secrets become credential
          requirements automatically.
        </p>
        <textarea
          data-testid="paste-mcp"
          className={selectClass + ' min-h-[120px] font-mono text-xs'}
          placeholder='{ "mcpServers": { "brave": { "command": "npx", "args": ["-y", "..."], "env": { "BRAVE_API_KEY": "..." } } } }'
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!paste.trim()}
            onClick={async () => setPreview(await api.pasteMcpPreview(paste))}>
            Preview
          </Button>
          <Button size="sm" data-testid="paste-mcp-add"
            disabled={!preview || preview.servers.length === 0}
            onClick={() => { apply(api.addPastedMcp(paste)); setPaste(''); setPreview(null); }}>
            Add {preview?.servers.length ? `(${preview.servers.length})` : ''}
          </Button>
        </div>
        {preview && (
          <div className="text-xs">
            {preview.servers.map((s) => <div key={s.id}>✓ {s.id} <span className="text-muted-foreground">({s.transport})</span></div>)}
            {preview.credentials.map((c) => <div key={c.ref} className="text-amber-500">needs {c.ref}</div>)}
            {preview.lossiness.map((l, i) => <div key={i} className="text-muted-foreground">⚠ {l}</div>)}
            {preview.servers.length === 0 && <div className="text-destructive">No MCP servers found in that config.</div>}
          </div>
        )}
      </div>
```

Import `McpNormalizePreview` in the Inspector's type imports.

- [ ] **Step 4: Build the web client + typecheck**

Run: `pnpm --filter @uniqent/studio build && pnpm --filter @uniqent/studio typecheck`
Expected: build + typecheck succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/studio/web/src/api.ts apps/studio/web/src/types.ts apps/studio/web/src/Inspector.tsx
git commit -m "feat(studio): Paste-config mode in the Custom MCP panel"
```

---

## Task 6: Full verification + browser dogfood

- [ ] **Step 1: Whole-repo gates**

Run: `pnpm build && pnpm typecheck && pnpm test && pnpm lint`
Expected: all green.

- [ ] **Step 2: Restart Studio**

```bash
UNIQENT_STUDIO_PORT=4173 pnpm --filter @uniqent/studio start &
```

- [ ] **Step 3: Browser dogfood** — open `http://127.0.0.1:4173`, click **Custom / import…** under STACK (MCP), paste a real `mcpServers` blob with a fake `sk-…` key, click **Preview** (see the server + "needs …_api_key"), click **Add**, confirm the MCP node appears on the canvas and the footer shows a credential required. Screenshot each step.

- [ ] **Step 4: Final commit (if any tweaks)** and open PR.

---

## Self-Review notes

- **Spec coverage:** Part 1 → Tasks 1–2; Part 2 → Task 3; Part 3 → Tasks 4–5. Gate-passes proof in Task 2 Step 1. ✓
- **Type consistency:** `normalizeMcpConfig`/`NormalizeResult` used identically in builder, session, github-mcp. `previewPastedMcp`/`addPastedMcp` names match across session+api+client. `McpNormalizePreview` mirrors `NormalizeResult` on the client. ✓
- **No `headers` in canonical schema** — handled by converting headers→auth in `mapOne`. ✓
- **Secrets:** every lifted secret becomes `${credentialRef:…}`; gate stays fail-closed. ✓
