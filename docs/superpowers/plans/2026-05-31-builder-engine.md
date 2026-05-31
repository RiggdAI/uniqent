# Builder Engine (`packages/builder`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build `@uniqent/builder` — the headless "assemble a brain" engine (Brain model + auto-derivation + catalogs) that emits a validated `@uniqent/core` Bundle.

**Architecture:** A mutable `Brain` holds component state and `toBundle()` assembles a core `Bundle` with auto-derived `components`/`permissions`/`consumedBy`. Pure `derive.ts` helpers + data-only catalogs. See `docs/superpowers/specs/2026-05-31-builder-engine-design.md`.

**Tech Stack:** TypeScript (ESM, NodeNext), `@uniqent/core`, `@uniqent/spec`, vitest.

> **Commit policy:** Do NOT commit per task. Stage as you go; land all of M2 as ONE squashed feature commit at the end.

---

## File structure

```
packages/builder/package.json, tsconfig.json, vitest.config.ts   # NEW
packages/builder/src/index.ts          # re-exports
packages/builder/src/derive.ts         # deriveComponents, derivePermissions
packages/builder/src/brain.ts          # Brain
packages/builder/src/catalog/mcp.ts    # MCP_CATALOG
packages/builder/src/catalog/skills.ts # SKILL_CATALOG
packages/builder/src/catalog/index.ts  # re-exports
packages/builder/test/derive.test.ts
packages/builder/test/catalog.test.ts
packages/builder/test/brain.test.ts
```

Conventions match other packages: src imports use `.js`; test imports extensionless.

---

### Task 1: Scaffold `@uniqent/builder`

**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`.

- [ ] **package.json** — name `@uniqent/builder`, type module, scripts build/typecheck/test (same as `@uniqent/core`), deps `@uniqent/core: workspace:*`, `@uniqent/spec: workspace:*`, devDep `vitest: ^3.0.0`.
- [ ] **tsconfig.json** — extends `../../tsconfig.base.json`, `outDir dist`, `rootDir src`, include `src`.
- [ ] **vitest.config.ts** — include `['test/**/*.test.ts','src/**/*.test.ts']`.
- [ ] **Run** `pnpm install`. Expected: links workspace deps.

---

### Task 2: Catalogs

**Files:** `src/catalog/mcp.ts`, `src/catalog/skills.ts`, `src/catalog/index.ts`. **Test:** `test/catalog.test.ts`.

- [ ] **Test first** (`test/catalog.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { MCP_CATALOG, SKILL_CATALOG } from '../src/catalog/index';
import { McpServer } from '@uniqent/spec';

describe('catalogs', () => {
  it('every MCP catalog server is schema-valid', () => {
    for (const e of MCP_CATALOG) expect(McpServer.safeParse(e.server).success).toBe(true);
  });
  it('github entry carries a credential requirement', () => {
    const gh = MCP_CATALOG.find((e) => e.id === 'github');
    expect(gh?.credential?.ref).toBe('github_pat');
  });
  it('filesystem is a stdio server', () => {
    const fs = MCP_CATALOG.find((e) => e.id === 'filesystem');
    expect(fs?.server.transport).toBe('stdio');
  });
  it('skill catalog has code-review and summarize', () => {
    expect(SKILL_CATALOG.map((s) => s.name).sort()).toEqual(['code-review', 'summarize']);
  });
});
```

- [ ] **Implement** `src/catalog/mcp.ts`: export `interface McpCatalogEntry { id; name; description; server: McpServer; credential?: CredentialRequirement }` and `MCP_CATALOG` with `github` (streamable-http, url `https://api.githubcopilot.com/mcp/`, bearer `github_pat`, credential apiKey required with help URL), `filesystem` (stdio, `npx -y @modelcontextprotocol/server-filesystem ${HOME}`, auth none), `fetch` (stdio, `npx -y @modelcontextprotocol/server-fetch`, auth none).
- [ ] **Implement** `src/catalog/skills.ts`: `interface SkillCatalogEntry { name; description; skillMd }` and `SKILL_CATALOG` with `code-review` and `summarize` (each a small valid SKILL.md with frontmatter).
- [ ] **Implement** `src/catalog/index.ts`: `export * from './mcp.js'; export * from './skills.js';`
- [ ] **Run** `pnpm --filter @uniqent/builder exec vitest run test/catalog.test.ts` → PASS.

---

### Task 3: Derivation helpers

**Files:** `src/derive.ts`. **Test:** `test/derive.test.ts`.

- [ ] **Test first** (`test/derive.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { derivePermissions } from '../src/derive';

describe('derivePermissions', () => {
  it('collects MCP http hosts and flags stdio process spawning', () => {
    const p = derivePermissions(
      [
        {
          id: 'gh',
          transport: 'streamable-http',
          url: 'https://api.example.com/mcp',
          auth: { type: 'none' },
          tools: { include: 'all' },
        },
        {
          id: 'fs',
          transport: 'stdio',
          command: 'npx',
          auth: { type: 'none' },
          tools: { include: 'all' },
        },
      ] as never,
      [],
      undefined,
      undefined,
    );
    expect(p.network.endpoints).toContain('api.example.com');
    expect(p.spawnsProcesses).toBe(true);
    expect(p.autonomy).toBe('suggest');
  });

  it('override wins over derived values', () => {
    const p = derivePermissions(
      [],
      [],
      { autonomy: 'auto' },
      { filesystem: { read: ['~/x'], write: [] }, autonomy: 'manual' },
    );
    expect(p.autonomy).toBe('manual');
    expect(p.filesystem.read).toEqual(['~/x']);
  });
});
```

- [ ] **Implement** `src/derive.ts`:
  - `deriveComponents(input)` where input = `{ hasPersona: boolean; facts: number; episodic: number; hasProfile: boolean; skills: string[]; mcp: string[]; tools: string[]; tasks: string[]; channels: string[] }` → returns a `Components`-shaped object (`skills/mcp/...` arrays sorted).
  - `derivePermissions(mcp: McpServer[], channels: Channel[], runtime: RuntimeConfig | undefined, override: Partial<PermissionScope> | undefined): PermissionScope` per spec (hosts from `url` via `new URL().host`, ignore parse failures; `spawnsProcesses` if any stdio; `autonomy = override?.autonomy ?? runtime?.autonomy ?? 'suggest'`; `filesystem = override?.filesystem ?? {read:[],write:[]}`; `network = override?.network ?? {endpoints: sorted unique}`; `notes = override?.notes`).
- [ ] **Run** `pnpm --filter @uniqent/builder exec vitest run test/derive.test.ts` → PASS.

---

### Task 4: `Brain`

**Files:** `src/brain.ts`, `src/index.ts`. **Test:** `test/brain.test.ts`.

- [ ] **Test first** (`test/brain.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain';
import { validateBundle, canonicalDigest } from '@uniqent/core';

function baseMeta() {
  return {
    name: 'demo',
    displayName: 'Demo',
    version: '0.1.0',
    description: 'demo brain',
    author: { name: 'Me' },
    license: 'CC0-1.0',
    tags: ['demo'],
  };
}

describe('Brain', () => {
  it('assembles a valid bundle from scratch + catalog', () => {
    const b = Brain.create(baseMeta());
    b.setPersona('# Persona\nHelpful.\n');
    b.addMemory({
      id: 'f1',
      kind: 'fact',
      text: 'prefers TS',
      createdAt: '2026-05-31T00:00:00.000Z',
    });
    b.addMcpFromCatalog('github');
    b.addSkillFromCatalog('code-review');
    const result = validateBundle(b.toBundle());
    expect(result.ok).toBe(true);
  });

  it('catalog MCP adds its credential and consumedBy is synced', () => {
    const b = Brain.create(baseMeta());
    b.addMcpFromCatalog('github');
    const m = b.toBundle().manifest();
    const cred = m.credentials.find((c) => c.ref === 'github_pat');
    expect(cred).toBeDefined();
    expect(cred?.consumedBy).toContain('mcp:github');
  });

  it('routes episodic memory to episodic and others to facts', () => {
    const b = Brain.create(baseMeta());
    b.addMemory({
      id: 'e1',
      kind: 'episodic',
      text: 'said hi',
      createdAt: '2026-05-31T00:00:00.000Z',
    });
    b.addMemory({ id: 'f1', kind: 'fact', text: 'x', createdAt: '2026-05-31T00:00:00.000Z' });
    const bundle = b.toBundle();
    expect(bundle.memoryEpisodic()).toHaveLength(1);
    expect(bundle.memoryFacts()).toHaveLength(1);
  });

  it('derives components and stdio process-spawn permission', () => {
    const b = Brain.create(baseMeta());
    b.addMcpFromCatalog('filesystem');
    const m = b.toBundle().manifest();
    expect(m.components.mcp).toContain('filesystem');
    expect(m.permissions.spawnsProcesses).toBe(true);
  });

  it('round-trips: fromBundle(toBundle) is digest-stable', () => {
    const b = Brain.create(baseMeta());
    b.setPersona('# Persona\nHi.\n');
    b.addMemory({ id: 'f1', kind: 'fact', text: 'x', createdAt: '2026-05-31T00:00:00.000Z' });
    b.addMcpFromCatalog('github');
    b.addSkillFromCatalog('summarize');
    const first = b.toBundle();
    const round = Brain.fromBundle(first).toBundle();
    expect(canonicalDigest(round)).toBe(canonicalDigest(first));
  });
});
```

- [ ] **Implement** `src/brain.ts` — the `Brain` class per the design spec: private state; `static create(meta)`; setters/adders that normalize inputs through spec schemas (`MemoryItem.parse`, `McpServer.parse`, `Channel.parse`, `Task.parse`, `ToolDecl.parse`, `RuntimeConfig.parse`, `CredentialRequirement.parse`); `addMcpFromCatalog`/`addSkillFromCatalog` (look up entry, add server + credential / skill); private `syncedCredentials()` (auto-fill `consumedBy`); private `buildManifest()` (specVersion `0.1`, meta, `compatibility.targets`, `components` via `deriveComponents`, `permissions` via `derivePermissions`, synced `credentials`); `toBundle()` (write all files + manifest, deterministic `JSON.stringify(x, null, 2)`, JSONL one parsed item per line); `validate()`; `static fromBundle(bundle)` (hydrate all fields, set `permissions` override = `manifest.permissions` for round-trip fidelity, capture extra skill files).
- [ ] **Implement** `src/index.ts`: `export * from './brain.js'; export * from './derive.js'; export * from './catalog/index.js';`
- [ ] **Run** `pnpm --filter @uniqent/builder exec vitest run` → all PASS.

---

### Task 5: Gate + squash commit

- [ ] **Run** `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm format:check` (run `pnpm format` if needed). All green.
- [ ] **Update** `CLAUDE.md` status → M2 complete, next M3.
- [ ] **Squash commit**:

```bash
git add -A
git commit -m "feat: M2 builder engine (@uniqent/builder)

Add @uniqent/builder: editable Brain model that assembles a validated
core Bundle, auto-derived components/permissions/consumedBy, and seed
MCP + skill catalogs. Headless and unit-tested; M2 acceptance met.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

## Self-review

Covers spec: Brain editing + toBundle (Task 4), derivation (Task 3), catalogs (Task 2), round-trip + validation + acceptance (Task 4 tests). No placeholders. Types reused from `@uniqent/spec`/`@uniqent/core`; `Brain` method names consistent with the design spec.
