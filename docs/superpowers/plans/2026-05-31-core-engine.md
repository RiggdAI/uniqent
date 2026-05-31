# Core Engine (`packages/core`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@uniqent/core` — the Node-side engine that reads, validates, secret-scans, digests, and Ed25519-signs `.uniqent` bundles — plus add `MemoryItem.visibility` to the spec.

**Architecture:** A `Bundle` holds an in-memory `Map<relativePath, bytes>` (Approach A) with typed accessors that parse against `@uniqent/spec`. A canonical digest hashes the preserved file bytes (excluding `signature.json`), so `unpack(pack(b))` reproduces the digest. A fail-closed `scanForSecrets` runs inside `validate`, `pack`, and `sign`. See `docs/superpowers/specs/2026-05-31-core-engine-design.md`.

**Tech Stack:** TypeScript (ESM, NodeNext), zod via `@uniqent/spec`, `@noble/ed25519`, `tar-stream`, `node:zlib`, `node:crypto`, vitest.

> **Commit policy (per maintainer):** Do NOT commit task-by-task. Stage with `git add` as you finish each task, and land ALL of M1 as a single squashed feature commit at the very end (Task 9, final step). Every intermediate step says "Stage (do not commit yet)" — only the final step runs `git commit`.

---

## File structure

```
packages/spec/src/memory.ts        # MODIFY: add MemoryItem.visibility
packages/spec/test/manifest.test.ts# MODIFY: visibility tests
packages/spec/schema/uniqent.schema.json   # REGENERATED
docs/SPEC.md                        # REGENERATED

packages/core/package.json          # NEW
packages/core/tsconfig.json         # NEW
packages/core/vitest.config.ts      # NEW
packages/core/src/index.ts          # NEW: public re-exports
packages/core/src/errors.ts         # NEW: typed error classes
packages/core/src/bundle.ts         # NEW: Bundle model + PATHS
packages/core/src/digest.ts         # NEW: canonicalDigest
packages/core/src/secret-scan.ts    # NEW: scanForSecrets
packages/core/src/validate.ts       # NEW: validateBundle / assertValid
packages/core/src/signing.ts        # NEW: generateKeypair / sign / verify
packages/core/src/archive.ts        # NEW: pack / unpack / readDir / writeDir
packages/core/src/secret-refs.ts    # NEW: findCredentialRefs / resolvePlaceholders
packages/core/test/helpers.ts       # NEW: makeValidBundle() fixture
packages/core/test/*.test.ts        # NEW: one per module
```

Conventions (match `packages/spec`): src imports use `.js` extensions; test imports are extensionless; `pnpm` from repo root.

---

### Task 0: Add `MemoryItem.visibility` to the spec

**Files:**

- Modify: `packages/spec/src/memory.ts`
- Test: `packages/spec/test/manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/spec/test/manifest.test.ts` inside the existing `describe('MemoryItem', ...)` block:

```ts
it('defaults visibility to shareable when omitted', () => {
  const r = MemoryItem.safeParse({
    id: 'm3',
    kind: 'fact',
    text: 'x',
    createdAt: '2026-05-31T00:00:00.000Z',
  });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.visibility).toBe('shareable');
});

it('accepts visibility "personal"', () => {
  const r = MemoryItem.safeParse({
    id: 'm4',
    kind: 'episodic',
    text: 'x',
    createdAt: '2026-05-31T00:00:00.000Z',
    visibility: 'personal',
  });
  expect(r.success).toBe(true);
});

it('rejects an invalid visibility', () => {
  const r = MemoryItem.safeParse({
    id: 'm5',
    kind: 'fact',
    text: 'x',
    createdAt: '2026-05-31T00:00:00.000Z',
    visibility: 'secret',
  });
  expect(r.success).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @uniqent/spec exec vitest run test/manifest.test.ts -t visibility`
Expected: FAIL (visibility is `undefined`, not `'shareable'`).

- [ ] **Step 3: Add the field**

In `packages/spec/src/memory.ts`, inside the `MemoryItem` object, add after the `importance` line:

```ts
  /** Privacy tier; export scrubs "personal" (and episodic) by default. */
  visibility: z.enum(['shareable', 'personal']).default('shareable'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @uniqent/spec exec vitest run test/manifest.test.ts`
Expected: PASS (all MemoryItem tests).

- [ ] **Step 5: Regenerate JSON Schema + SPEC.md and rebuild spec**

Run:

```bash
pnpm --filter @uniqent/spec gen
pnpm --filter @uniqent/spec build
pnpm --filter @uniqent/spec exec vitest run
```

Expected: gen writes the schema + SPEC.md; build succeeds; all spec tests pass (including the drift test, now matching the regenerated schema).

- [ ] **Step 6: Stage (do not commit yet)**

```bash
git add packages/spec/src/memory.ts packages/spec/test/manifest.test.ts packages/spec/schema/uniqent.schema.json docs/SPEC.md
```

---

### Task 1: Scaffold `@uniqent/core` + error classes

**Files:**

- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/errors.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/errors.test.ts`

- [ ] **Step 1: Create the package manifest**

`packages/core/package.json`:

```json
{
  "name": "@uniqent/core",
  "version": "0.1.0",
  "description": "Bundle read/write, validation, digest, secret-scan, and signing for .uniqent.",
  "license": "Apache-2.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@uniqent/spec": "workspace:*",
    "@noble/ed25519": "^2.1.0",
    "tar-stream": "^3.1.7"
  },
  "devDependencies": {
    "@types/tar-stream": "^3.1.3",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig and vitest config**

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/core/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
});
```

- [ ] **Step 3: Install dependencies**

Run: `pnpm install`
Expected: links `@uniqent/spec` into `packages/core/node_modules`, installs `@noble/ed25519` and `tar-stream`.

- [ ] **Step 4: Write the failing test**

`packages/core/test/errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SecretScanError, BundleValidationError, BundleFormatError } from '../src/errors';

describe('error classes', () => {
  it('SecretScanError carries findings and a name', () => {
    const e = new SecretScanError([{ path: 'uniqent.json', kind: 'openai', snippet: 'sk-…' }]);
    expect(e.name).toBe('SecretScanError');
    expect(e.findings).toHaveLength(1);
    expect(e instanceof Error).toBe(true);
  });

  it('BundleValidationError carries issues', () => {
    const e = new BundleValidationError([{ code: 'manifest', message: 'bad' }]);
    expect(e.name).toBe('BundleValidationError');
    expect(e.issues[0].code).toBe('manifest');
  });

  it('BundleFormatError is an Error', () => {
    expect(new BundleFormatError('x') instanceof Error).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/errors.test.ts`
Expected: FAIL ("Cannot find module '../src/errors'").

- [ ] **Step 6: Implement the error classes**

`packages/core/src/errors.ts`:

```ts
import type { SecretFinding } from './secret-scan.js';
import type { Issue } from './validate.js';

export class BundleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleFormatError';
  }
}

export class SecretScanError extends Error {
  readonly findings: SecretFinding[];
  constructor(findings: SecretFinding[]) {
    super(`secret scan failed: ${findings.length} likely secret(s) found`);
    this.name = 'SecretScanError';
    this.findings = findings;
  }
}

export class BundleValidationError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(`bundle validation failed: ${issues.length} error(s)`);
    this.name = 'BundleValidationError';
    this.issues = issues;
  }
}
```

Note: `SecretFinding` and `Issue` are defined in later tasks; these are `import type` (erased at runtime) so the test passes now and the types resolve once those files exist.

- [ ] **Step 7: Create a stub index re-exporting errors**

`packages/core/src/index.ts`:

```ts
export * from './errors.js';
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/errors.test.ts`
Expected: PASS.

- [ ] **Step 9: Stage (do not commit yet)**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts packages/core/src/errors.ts packages/core/src/index.ts packages/core/test/errors.test.ts pnpm-lock.yaml
```

---

### Task 2: `Bundle` model + `PATHS` + test fixture

**Files:**

- Create: `packages/core/src/bundle.ts`, `packages/core/test/helpers.ts`
- Test: `packages/core/test/bundle.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/bundle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Bundle, PATHS } from '../src/bundle';
import { BundleFormatError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('Bundle', () => {
  it('stores and reads raw files as bytes and text', () => {
    const b = Bundle.empty();
    b.set('a.txt', 'hello');
    expect(b.has('a.txt')).toBe(true);
    expect(b.getText('a.txt')).toBe('hello');
    expect(b.get('a.txt')).toBeInstanceOf(Uint8Array);
  });

  it('lists paths sorted and supports delete', () => {
    const b = Bundle.empty();
    b.set('b.txt', '1');
    b.set('a.txt', '2');
    expect(b.list()).toEqual(['a.txt', 'b.txt']);
    expect(b.delete('a.txt')).toBe(true);
    expect(b.list()).toEqual(['b.txt']);
  });

  it('parses the manifest via a typed accessor', () => {
    const b = makeValidBundle();
    expect(b.manifest().name).toBe('test-brain');
  });

  it('throws BundleFormatError when manifest is missing', () => {
    expect(() => Bundle.empty().manifest()).toThrow(BundleFormatError);
  });

  it('reads memory facts and skill names', () => {
    const b = makeValidBundle();
    expect(b.memoryFacts()).toHaveLength(1);
    expect(b.memoryFacts()[0].kind).toBe('fact');
    expect(b.skillNames()).toEqual(['code-review']);
  });

  it('reads MCP servers and returns [] for absent components', () => {
    const b = makeValidBundle();
    expect(b.mcpServers()[0].id).toBe('github');
    expect(b.channels()).toEqual([]);
    expect(b.runtime()).toBeUndefined();
    expect(b.signature()).toBeUndefined();
  });

  it('exposes PATHS constants', () => {
    expect(PATHS.manifest).toBe('uniqent.json');
    expect(PATHS.signature).toBe('signature.json');
  });
});
```

- [ ] **Step 2: Create the fixture helper**

`packages/core/test/helpers.ts`:

```ts
import { Bundle } from '../src/bundle';

const MANIFEST = {
  specVersion: '0.1',
  name: 'test-brain',
  displayName: 'Test Brain',
  version: '0.1.0',
  description: 'A fixture brain.',
  author: { name: 'Test' },
  license: 'CC0-1.0',
  tags: ['test'],
  components: {
    identity: true,
    memory: { facts: 1, episodic: 0, hasProfile: false },
    skills: ['code-review'],
    mcp: ['github'],
    tools: [],
    tasks: [],
    channels: [],
  },
  credentials: [
    {
      ref: 'github_pat',
      label: 'GitHub PAT',
      type: 'apiKey',
      consumedBy: ['mcp:github'],
      required: true,
    },
  ],
  permissions: {
    filesystem: { read: [], write: [] },
    network: { endpoints: ['api.github.com'] },
    autonomy: 'suggest',
    spawnsProcesses: false,
  },
  compatibility: { targets: ['claude-code'] },
};

const FACT = {
  id: 'f1',
  kind: 'fact',
  text: 'The user prefers TypeScript.',
  createdAt: '2026-05-31T00:00:00.000Z',
  importance: 0.8,
};

const SERVER = {
  id: 'github',
  transport: 'streamable-http',
  url: 'https://api.githubcopilot.com/mcp/',
  auth: { type: 'bearer', credentialRef: 'github_pat' },
  tools: { include: 'all' },
};

/** A minimal bundle that passes validateBundle(). */
export function makeValidBundle(): Bundle {
  const b = Bundle.empty();
  b.set('uniqent.json', JSON.stringify(MANIFEST, null, 2));
  b.set('identity/persona.md', '# Persona\nA helpful development agent.\n');
  b.set('memory/facts.jsonl', JSON.stringify(FACT) + '\n');
  b.set('skills/code-review/SKILL.md', '---\nname: code-review\n---\nReview code.\n');
  b.set('mcp/servers.json', JSON.stringify({ servers: [SERVER] }, null, 2));
  return b;
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/bundle.test.ts`
Expected: FAIL ("Cannot find module '../src/bundle'").

- [ ] **Step 4: Implement the Bundle model**

`packages/core/src/bundle.ts`:

```ts
import {
  Manifest,
  Signature,
  MemoryItem,
  MemoryProfile,
  McpServersFile,
  ChannelsFile,
  ToolsFile,
  Task,
  RuntimeConfig,
} from '@uniqent/spec';
import type {
  Manifest as TManifest,
  Signature as TSignature,
  MemoryItem as TMemoryItem,
  MemoryProfile as TMemoryProfile,
  McpServer,
  Channel,
  ToolDecl,
  Task as TTask,
  RuntimeConfig as TRuntimeConfig,
} from '@uniqent/spec';
import { BundleFormatError } from './errors.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PATHS = {
  manifest: 'uniqent.json',
  signature: 'signature.json',
  persona: 'identity/persona.md',
  policies: 'identity/policies.md',
  profile: 'memory/profile.json',
  facts: 'memory/facts.jsonl',
  episodic: 'memory/episodic.jsonl',
  mcp: 'mcp/servers.json',
  channels: 'channels/channels.json',
  tools: 'tools/tools.json',
  runtime: 'setup/runtime.json',
} as const;

export class Bundle {
  private readonly fileMap: Map<string, Uint8Array>;

  private constructor(files: Map<string, Uint8Array>) {
    this.fileMap = files;
  }

  static empty(): Bundle {
    return new Bundle(new Map());
  }

  static fromFiles(files: Map<string, Uint8Array>): Bundle {
    return new Bundle(new Map(files));
  }

  has(path: string): boolean {
    return this.fileMap.has(path);
  }

  get(path: string): Uint8Array | undefined {
    return this.fileMap.get(path);
  }

  getText(path: string): string | undefined {
    const bytes = this.fileMap.get(path);
    return bytes === undefined ? undefined : dec.decode(bytes);
  }

  set(path: string, content: Uint8Array | string): void {
    this.fileMap.set(path, typeof content === 'string' ? enc.encode(content) : content);
  }

  delete(path: string): boolean {
    return this.fileMap.delete(path);
  }

  list(): string[] {
    return [...this.fileMap.keys()].sort();
  }

  entries(): Array<[string, Uint8Array]> {
    return [...this.fileMap.entries()];
  }

  private parseJson(path: string): unknown {
    const text = this.getText(path);
    if (text === undefined) throw new BundleFormatError(`missing ${path}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new BundleFormatError(`${path} is not valid JSON`);
    }
  }

  manifest(): TManifest {
    const r = Manifest.safeParse(this.parseJson(PATHS.manifest));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.manifest} failed schema: ${r.error.message}`);
    return r.data;
  }

  signature(): TSignature | undefined {
    if (!this.has(PATHS.signature)) return undefined;
    const r = Signature.safeParse(this.parseJson(PATHS.signature));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.signature} failed schema: ${r.error.message}`);
    return r.data;
  }

  persona(): string | undefined {
    return this.getText(PATHS.persona);
  }

  policies(): string | undefined {
    return this.getText(PATHS.policies);
  }

  memoryProfile(): TMemoryProfile | undefined {
    if (!this.has(PATHS.profile)) return undefined;
    const r = MemoryProfile.safeParse(this.parseJson(PATHS.profile));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.profile} failed schema: ${r.error.message}`);
    return r.data;
  }

  private memoryLines(path: string): TMemoryItem[] {
    const text = this.getText(path);
    if (text === undefined) return [];
    const items: TMemoryItem[] = [];
    text.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch {
        throw new BundleFormatError(`${path}:${i + 1} is not valid JSON`);
      }
      const r = MemoryItem.safeParse(json);
      if (!r.success)
        throw new BundleFormatError(`${path}:${i + 1} failed schema: ${r.error.message}`);
      items.push(r.data);
    });
    return items;
  }

  memoryFacts(): TMemoryItem[] {
    return this.memoryLines(PATHS.facts);
  }

  memoryEpisodic(): TMemoryItem[] {
    return this.memoryLines(PATHS.episodic);
  }

  mcpServers(): McpServer[] {
    if (!this.has(PATHS.mcp)) return [];
    const r = McpServersFile.safeParse(this.parseJson(PATHS.mcp));
    if (!r.success) throw new BundleFormatError(`${PATHS.mcp} failed schema: ${r.error.message}`);
    return r.data.servers;
  }

  channels(): Channel[] {
    if (!this.has(PATHS.channels)) return [];
    const r = ChannelsFile.safeParse(this.parseJson(PATHS.channels));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.channels} failed schema: ${r.error.message}`);
    return r.data.channels;
  }

  tools(): ToolDecl[] {
    if (!this.has(PATHS.tools)) return [];
    const r = ToolsFile.safeParse(this.parseJson(PATHS.tools));
    if (!r.success) throw new BundleFormatError(`${PATHS.tools} failed schema: ${r.error.message}`);
    return r.data.tools;
  }

  tasks(): TTask[] {
    const out: TTask[] = [];
    for (const path of this.list()) {
      if (!path.startsWith('tasks/') || !path.endsWith('.json')) continue;
      const r = Task.safeParse(this.parseJson(path));
      if (!r.success) throw new BundleFormatError(`${path} failed schema: ${r.error.message}`);
      out.push(r.data);
    }
    return out;
  }

  runtime(): TRuntimeConfig | undefined {
    if (!this.has(PATHS.runtime)) return undefined;
    const r = RuntimeConfig.safeParse(this.parseJson(PATHS.runtime));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.runtime} failed schema: ${r.error.message}`);
    return r.data;
  }

  skillNames(): string[] {
    const names = new Set<string>();
    for (const path of this.list()) {
      const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
      if (m) names.add(m[1]);
    }
    return [...names].sort();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/bundle.test.ts`
Expected: PASS (7 tests). If `@uniqent/spec` types are stale, run `pnpm --filter @uniqent/spec build` first.

- [ ] **Step 6: Stage (do not commit yet)**

```bash
git add packages/core/src/bundle.ts packages/core/test/bundle.test.ts packages/core/test/helpers.ts
```

---

### Task 3: Canonical digest

**Files:**

- Create: `packages/core/src/digest.ts`
- Test: `packages/core/test/digest.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/digest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Bundle } from '../src/bundle';
import { canonicalDigest } from '../src/digest';

describe('canonicalDigest', () => {
  it('is identical for identical content regardless of insertion order', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    a.set('b.txt', '2');
    const b = Bundle.empty();
    b.set('b.txt', '2');
    b.set('a.txt', '1');
    expect(canonicalDigest(a)).toBe(canonicalDigest(b));
  });

  it('changes when any byte changes', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    const b = Bundle.empty();
    b.set('a.txt', '2');
    expect(canonicalDigest(a)).not.toBe(canonicalDigest(b));
  });

  it('excludes signature.json from the digest', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    const b = Bundle.empty();
    b.set('a.txt', '1');
    b.set('signature.json', '{"anything":true}');
    expect(canonicalDigest(a)).toBe(canonicalDigest(b));
  });

  it('returns a 64-char hex sha256 string', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    expect(canonicalDigest(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/digest.test.ts`
Expected: FAIL ("Cannot find module '../src/digest'").

- [ ] **Step 3: Implement the digest**

`packages/core/src/digest.ts`:

```ts
import { createHash } from 'node:crypto';
import { Bundle, PATHS } from './bundle.js';

/**
 * Deterministic content digest over preserved file bytes, excluding signature.json.
 * Independent of archive format and insertion order, so unpack(pack(b)) reproduces it.
 */
export function canonicalDigest(bundle: Bundle): string {
  const entries = bundle
    .entries()
    .filter(([path]) => path !== PATHS.signature)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let canonical = '';
  for (const [path, bytes] of entries) {
    const fileHash = createHash('sha256').update(bytes).digest('hex');
    canonical += `${path}\n${fileHash}\n`;
  }
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/digest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Stage (do not commit yet)**

```bash
git add packages/core/src/digest.ts packages/core/test/digest.test.ts
```

---

### Task 4: Secret-scan

**Files:**

- Create: `packages/core/src/secret-scan.ts`
- Test: `packages/core/test/secret-scan.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/secret-scan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Bundle } from '../src/bundle';
import { scanForSecrets } from '../src/secret-scan';
import { makeValidBundle } from './helpers';

describe('scanForSecrets', () => {
  it('finds nothing in a clean bundle', () => {
    expect(scanForSecrets(makeValidBundle())).toHaveLength(0);
  });

  it('detects an OpenAI-style key', () => {
    const b = Bundle.empty();
    b.set('notes.md', 'token: sk-abcdefghijklmnopqrstuvwxyz0123456789');
    const f = scanForSecrets(b);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].kind).toBe('openai');
  });

  it('detects a GitHub PAT, Slack token, AWS key, and PEM block', () => {
    const b = Bundle.empty();
    b.set('a.md', 'ghp_0123456789abcdefghijklmnopqrstuvwx');
    b.set('b.md', 'xoxb-0123456789-abcdefghij');
    b.set('c.md', 'AKIAIOSFODNN7EXAMPLE');
    b.set('d.md', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----');
    const kinds = scanForSecrets(b).map((x) => x.kind);
    expect(kinds).toContain('github-pat');
    expect(kinds).toContain('slack');
    expect(kinds).toContain('aws-access-key');
    expect(kinds).toContain('private-key');
  });

  it('detects a high-entropy token', () => {
    const b = Bundle.empty();
    b.set('a.md', 'value=Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv');
    expect(scanForSecrets(b).some((x) => x.kind === 'high-entropy')).toBe(true);
  });

  it('allows ${credentialRef:...} placeholders', () => {
    const b = Bundle.empty();
    b.set('mcp/servers.json', JSON.stringify({ token: '${credentialRef:github_pat}' }));
    expect(scanForSecrets(b)).toHaveLength(0);
  });

  it('skips signature.json and allowlists author.pubkey', () => {
    const b = Bundle.empty();
    b.set(
      'signature.json',
      JSON.stringify({ signature: 'A'.repeat(88), publicKey: 'B'.repeat(64) }),
    );
    b.set('uniqent.json', JSON.stringify({ author: { name: 'x', pubkey: 'deadbeef'.repeat(8) } }));
    expect(scanForSecrets(b)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/secret-scan.test.ts`
Expected: FAIL ("Cannot find module '../src/secret-scan'").

- [ ] **Step 3: Implement the secret-scan**

`packages/core/src/secret-scan.ts`:

```ts
import { Bundle, PATHS } from './bundle.js';

export interface SecretFinding {
  path: string;
  kind: string;
  snippet: string;
}

const dec = new TextDecoder();

const PREFIX_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'openai', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: 'github-pat', re: /\bgh[posru]_[A-Za-z0-9]{30,}\b/ },
  { kind: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'private-key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
];

const PLACEHOLDER_RE = /\$\{credentialRef:[^}]+\}/g;
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

/** Keys whose string values legitimately hold public key material; not secrets. */
const ALLOWLISTED_KEYS = new Set(['pubkey', 'publicKey']);

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function snippet(match: string): string {
  return match.length <= 12 ? match : `${match.slice(0, 6)}…${match.slice(-4)}`;
}

/** Detect a secret in a single string value (placeholders already allowed). */
function detect(value: string): { kind: string; snippet: string } | null {
  const cleaned = value.replace(PLACEHOLDER_RE, '');
  for (const { kind, re } of PREFIX_PATTERNS) {
    const m = re.exec(cleaned);
    if (m) return { kind, snippet: snippet(m[0]) };
  }
  for (const m of cleaned.matchAll(HIGH_ENTROPY_TOKEN)) {
    if (shannonEntropy(m[0]) >= 4.0) return { kind: 'high-entropy', snippet: snippet(m[0]) };
  }
  return null;
}

function walkJson(node: unknown, key: string | undefined, onString: (s: string) => void): void {
  if (typeof node === 'string') {
    if (key !== undefined && ALLOWLISTED_KEYS.has(key)) return;
    onString(node);
  } else if (Array.isArray(node)) {
    for (const item of node) walkJson(item, undefined, onString);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walkJson(v, k, onString);
  }
}

export function scanForSecrets(bundle: Bundle): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [path, bytes] of bundle.entries()) {
    if (path === PATHS.signature) continue;
    const text = dec.decode(bytes);

    const record = (hit: { kind: string; snippet: string } | null) => {
      if (hit) findings.push({ path, kind: hit.kind, snippet: hit.snippet });
    };

    if (path.endsWith('.json') || path.endsWith('.jsonl')) {
      const lines = path.endsWith('.jsonl') ? text.split('\n') : [text];
      let parsedAny = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          walkJson(JSON.parse(trimmed), undefined, (s) => record(detect(s)));
          parsedAny = true;
        } catch {
          record(detect(trimmed)); // malformed JSON: fall back to text scan
        }
      }
      if (!parsedAny && lines.every((l) => !l.trim())) continue;
    } else {
      record(detect(text));
    }
  }
  return findings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/secret-scan.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Stage (do not commit yet)**

```bash
git add packages/core/src/secret-scan.ts packages/core/test/secret-scan.test.ts
```

---

### Task 5: Validate

**Files:**

- Create: `packages/core/src/validate.ts`
- Test: `packages/core/test/validate.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateBundle, assertValid } from '../src/validate';
import { BundleValidationError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('validateBundle', () => {
  it('accepts a valid bundle', () => {
    const r = validateBundle(makeValidBundle());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('errors when identity is declared but persona.md is missing', () => {
    const b = makeValidBundle();
    b.delete('identity/persona.md');
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'layout')).toBe(true);
  });

  it('errors on a dangling credentialRef', () => {
    const b = makeValidBundle();
    b.set(
      'mcp/servers.json',
      JSON.stringify({
        servers: [
          {
            id: 'github',
            transport: 'streamable-http',
            url: 'https://example.com/mcp',
            auth: { type: 'bearer', credentialRef: 'does_not_exist' },
            tools: { include: 'all' },
          },
        ],
      }),
    );
    const r = validateBundle(b);
    expect(r.errors.some((e) => e.code === 'credential-ref')).toBe(true);
  });

  it('errors when a planted secret is present', () => {
    const b = makeValidBundle();
    b.set('identity/persona.md', 'my key is sk-abcdefghijklmnopqrstuvwxyz0123456789');
    const r = validateBundle(b);
    expect(r.errors.some((e) => e.code === 'secret')).toBe(true);
  });

  it('errors when a declared skill is missing SKILL.md', () => {
    const b = makeValidBundle();
    b.delete('skills/code-review/SKILL.md');
    const r = validateBundle(b);
    expect(r.errors.some((e) => e.code === 'layout')).toBe(true);
  });

  it('assertValid throws BundleValidationError on an invalid bundle', () => {
    expect(() => assertValid(Bundle_emptyManifestless())).toThrow(BundleValidationError);
  });
});

function Bundle_emptyManifestless() {
  const b = makeValidBundle();
  b.delete('uniqent.json');
  return b;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/validate.test.ts`
Expected: FAIL ("Cannot find module '../src/validate'").

- [ ] **Step 3: Implement validate**

`packages/core/src/validate.ts`:

```ts
import { Bundle, PATHS } from './bundle.js';
import { scanForSecrets } from './secret-scan.js';
import { BundleValidationError } from './errors.js';

export interface Issue {
  path?: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export function validateBundle(bundle: Bundle): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  // 1. Manifest + component files parse (each accessor throws on malformed content).
  let manifest;
  try {
    manifest = bundle.manifest();
  } catch (e) {
    errors.push({ path: PATHS.manifest, code: 'manifest', message: (e as Error).message });
  }

  const parseChecks: Array<[string, () => unknown]> = [
    ['mcp', () => bundle.mcpServers()],
    ['channels', () => bundle.channels()],
    ['tools', () => bundle.tools()],
    ['tasks', () => bundle.tasks()],
    ['memory', () => bundle.memoryFacts()],
    ['memory', () => bundle.memoryEpisodic()],
    ['memory', () => bundle.memoryProfile()],
  ];
  for (const [code, fn] of parseChecks) {
    try {
      fn();
    } catch (e) {
      errors.push({ code, message: (e as Error).message });
    }
  }

  if (manifest) {
    // 2. Layout.
    if (manifest.components.identity && !bundle.has(PATHS.persona)) {
      errors.push({
        path: PATHS.persona,
        code: 'layout',
        message: 'components.identity is true but identity/persona.md is missing',
      });
    }
    const presentSkills = new Set(bundle.skillNames());
    for (const skill of manifest.components.skills) {
      if (!presentSkills.has(skill)) {
        errors.push({
          path: `skills/${skill}/SKILL.md`,
          code: 'layout',
          message: `declared skill "${skill}" has no skills/${skill}/SKILL.md`,
        });
      }
    }

    // 3. Cross-reference integrity.
    const refs = new Set(manifest.credentials.map((c) => c.ref));
    try {
      for (const s of bundle.mcpServers()) {
        const ref = s.auth.credentialRef;
        if (ref && !refs.has(ref)) {
          errors.push({
            path: PATHS.mcp,
            code: 'credential-ref',
            message: `mcp server "${s.id}" references unknown credentialRef "${ref}"`,
          });
        }
      }
      for (const c of bundle.channels()) {
        if (c.credentialRef && !refs.has(c.credentialRef)) {
          errors.push({
            path: PATHS.channels,
            code: 'credential-ref',
            message: `channel "${c.id}" references unknown credentialRef "${c.credentialRef}"`,
          });
        }
      }
    } catch {
      // parse errors already recorded above
    }
  }

  // 4. Secret-scan.
  for (const f of scanForSecrets(bundle)) {
    errors.push({
      path: f.path,
      code: 'secret',
      message: `possible ${f.kind} secret (${f.snippet})`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertValid(bundle: Bundle): void {
  const result = validateBundle(bundle);
  if (!result.ok) throw new BundleValidationError(result.errors);
}
```

- [ ] **Step 4: Add the missing import to the test**

At the top of `packages/core/test/validate.test.ts`, add `Bundle` to the imports (used by the helper):

```ts
import { Bundle } from '../src/bundle';
```

Then change the helper to use it (replace the `Bundle_emptyManifestless` function body is already correct; just ensure the import exists). Re-run.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/validate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Stage (do not commit yet)**

```bash
git add packages/core/src/validate.ts packages/core/test/validate.test.ts
```

---

### Task 6: Signing (keygen / sign / verify)

**Files:**

- Create: `packages/core/src/signing.ts`
- Test: `packages/core/test/signing.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/signing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateKeypair, sign, verify } from '../src/signing';
import { SecretScanError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('signing', () => {
  it('signs and verifies a clean bundle', async () => {
    const { privateKey } = await generateKeypair();
    const signed = await sign(makeValidBundle(), privateKey);
    expect(signed.signature()).toBeDefined();
    const v = await verify(signed);
    expect(v).toMatchObject({ signed: true, valid: true });
  });

  it('reports unsigned bundles', async () => {
    const v = await verify(makeValidBundle());
    expect(v.signed).toBe(false);
    expect(v.valid).toBe(false);
  });

  it('fails verification when a file is tampered after signing', async () => {
    const { privateKey } = await generateKeypair();
    const signed = await sign(makeValidBundle(), privateKey);
    signed.set('identity/persona.md', '# Persona\nTAMPERED.\n');
    const v = await verify(signed);
    expect(v.valid).toBe(false);
  });

  it('throws SecretScanError when signing a bundle with a secret', async () => {
    const { privateKey } = await generateKeypair();
    const b = makeValidBundle();
    b.set('notes.md', 'sk-abcdefghijklmnopqrstuvwxyz0123456789');
    await expect(sign(b, privateKey)).rejects.toBeInstanceOf(SecretScanError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/signing.test.ts`
Expected: FAIL ("Cannot find module '../src/signing'").

- [ ] **Step 3: Implement signing**

`packages/core/src/signing.ts`:

```ts
import * as ed from '@noble/ed25519';
import { Bundle, PATHS } from './bundle.js';
import { canonicalDigest } from './digest.js';
import { scanForSecrets } from './secret-scan.js';
import { SecretScanError } from './errors.js';

const enc = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}
function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export interface Keypair {
  privateKey: string;
  publicKey: string;
}

export interface VerifyResult {
  signed: boolean;
  valid: boolean;
  reason?: string;
  publicKey?: string;
}

export async function generateKeypair(): Promise<Keypair> {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  return { privateKey: toHex(priv), publicKey: toHex(pub) };
}

/** Runs the secret-scan gate, signs the canonical digest, returns a new signed Bundle. */
export async function sign(bundle: Bundle, privateKeyHex: string): Promise<Bundle> {
  const findings = scanForSecrets(bundle);
  if (findings.length) throw new SecretScanError(findings);

  const digest = canonicalDigest(bundle);
  const priv = fromHex(privateKeyHex);
  const pub = await ed.getPublicKeyAsync(priv);
  const sig = await ed.signAsync(enc.encode(digest), priv);

  const signature = {
    algorithm: 'ed25519' as const,
    publicKey: toHex(pub),
    digestAlgorithm: 'sha256' as const,
    digest,
    signature: toHex(sig),
    signedAt: new Date().toISOString(),
  };

  const out = Bundle.fromFiles(new Map(bundle.entries()));
  out.set(PATHS.signature, JSON.stringify(signature, null, 2));
  return out;
}

export async function verify(bundle: Bundle): Promise<VerifyResult> {
  const signature = bundle.signature();
  if (!signature) return { signed: false, valid: false };

  const recomputed = canonicalDigest(bundle);
  if (recomputed !== signature.digest) {
    return {
      signed: true,
      valid: false,
      reason: 'digest mismatch (content changed)',
      publicKey: signature.publicKey,
    };
  }
  const ok = await ed.verifyAsync(
    fromHex(signature.signature),
    enc.encode(signature.digest),
    fromHex(signature.publicKey),
  );
  return {
    signed: true,
    valid: ok,
    reason: ok ? undefined : 'invalid signature',
    publicKey: signature.publicKey,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/signing.test.ts`
Expected: PASS (4 tests). (`@noble/ed25519` v2 uses the global `crypto.subtle`, available in Node 20+, so no extra hash wiring is needed.)

- [ ] **Step 5: Stage (do not commit yet)**

```bash
git add packages/core/src/signing.ts packages/core/test/signing.test.ts
```

---

### Task 7: Archive (pack / unpack / readDir / writeDir)

**Files:**

- Create: `packages/core/src/archive.ts`
- Test: `packages/core/test/archive.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/archive.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, unpack, readDir, writeDir } from '../src/archive';
import { canonicalDigest } from '../src/digest';
import { SecretScanError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('archive', () => {
  it('round-trips pack/unpack with a stable content digest', async () => {
    const b = makeValidBundle();
    const before = canonicalDigest(b);
    const bytes = await pack(b);
    const restored = await unpack(bytes);
    expect(canonicalDigest(restored)).toBe(before);
    expect(restored.manifest().name).toBe('test-brain');
  });

  it('pack throws SecretScanError on a planted secret', async () => {
    const b = makeValidBundle();
    b.set('notes.md', 'ghp_0123456789abcdefghijklmnopqrstuvwx');
    await expect(pack(b)).rejects.toBeInstanceOf(SecretScanError);
  });

  it('round-trips through a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'uniqent-'));
    try {
      const b = makeValidBundle();
      await writeDir(b, dir);
      const restored = await readDir(dir);
      expect(canonicalDigest(restored)).toBe(canonicalDigest(b));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('unpack throws on an archive with no manifest', async () => {
    const b = Bundle_noManifest();
    const bytes = await pack(b, { skipValidation: true });
    await expect(unpack(bytes)).rejects.toThrow();
  });
});

function Bundle_noManifest() {
  const b = makeValidBundle();
  b.delete('uniqent.json');
  return b;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/archive.test.ts`
Expected: FAIL ("Cannot find module '../src/archive'").

- [ ] **Step 3: Implement archive**

`packages/core/src/archive.ts`:

```ts
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { pack as tarPack, extract as tarExtract } from 'tar-stream';
import { Bundle, PATHS } from './bundle.js';
import { assertValid } from './validate.js';
import { scanForSecrets } from './secret-scan.js';
import { SecretScanError, BundleFormatError } from './errors.js';

export interface PackOptions {
  skipValidation?: boolean;
}

/** Validate (unless skipped) + secret-scan gate, then tar+gzip to bytes. */
export async function pack(bundle: Bundle, opts: PackOptions = {}): Promise<Uint8Array> {
  const findings = scanForSecrets(bundle);
  if (findings.length) throw new SecretScanError(findings);
  if (!opts.skipValidation) assertValid(bundle);

  const tar = tarPack();
  const chunks: Buffer[] = [];
  tar.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    tar.on('end', resolve);
    tar.on('error', reject);
  });

  for (const [path, bytes] of bundle.entries().sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    tar.entry(
      { name: path, size: bytes.length, mtime: new Date(0), mode: 0o644 },
      Buffer.from(bytes),
    );
  }
  tar.finalize();
  await done;

  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

export async function unpack(input: Uint8Array): Promise<Bundle> {
  const tarBytes = gunzipSync(Buffer.from(input));
  const files = new Map<string, Uint8Array>();
  const extract = tarExtract();

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const parts: Buffer[] = [];
      stream.on('data', (c: Buffer) => parts.push(c));
      stream.on('end', () => {
        if (header.type === 'file') files.set(header.name, new Uint8Array(Buffer.concat(parts)));
        next();
      });
      stream.on('error', reject);
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });

  extract.end(tarBytes);
  await done;

  if (!files.has(PATHS.manifest)) {
    throw new BundleFormatError('archive does not contain uniqent.json');
  }
  return Bundle.fromFiles(files);
}

export async function writeDir(bundle: Bundle, dir: string): Promise<void> {
  for (const [path, bytes] of bundle.entries()) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

export async function readDir(dir: string): Promise<Bundle> {
  const files = new Map<string, Uint8Array>();
  async function walk(current: string): Promise<void> {
    for (const name of await readdir(current)) {
      const full = join(current, name);
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full);
      } else {
        const rel = relative(dir, full).split(sep).join('/');
        files.set(rel, new Uint8Array(await readFile(full)));
      }
    }
  }
  await walk(dir);
  if (!files.has(PATHS.manifest)) {
    throw new BundleFormatError(`${dir} does not contain uniqent.json`);
  }
  return Bundle.fromFiles(files);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/archive.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Stage (do not commit yet)**

```bash
git add packages/core/src/archive.ts packages/core/test/archive.test.ts
```

---

### Task 8: Secret-ref helpers

**Files:**

- Create: `packages/core/src/secret-refs.ts`
- Test: `packages/core/test/secret-refs.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/secret-refs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Bundle } from '../src/bundle';
import { findCredentialRefs, resolvePlaceholders } from '../src/secret-refs';

describe('secret-refs', () => {
  it('finds credentialRef placeholders across files', () => {
    const b = Bundle.empty();
    b.set('mcp/servers.json', JSON.stringify({ env: { TOKEN: '${credentialRef:github_pat}' } }));
    b.set('a.md', 'uses ${credentialRef:other}');
    const refs = findCredentialRefs(b);
    expect(refs.map((r) => r.ref).sort()).toEqual(['github_pat', 'other']);
  });

  it('resolves placeholders from a map', () => {
    expect(resolvePlaceholders('Bearer ${credentialRef:tok}', { tok: 'XYZ' })).toBe('Bearer XYZ');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(resolvePlaceholders('${credentialRef:missing}', {})).toBe('${credentialRef:missing}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/secret-refs.test.ts`
Expected: FAIL ("Cannot find module '../src/secret-refs'").

- [ ] **Step 3: Implement secret-refs**

`packages/core/src/secret-refs.ts`:

```ts
import { Bundle, PATHS } from './bundle.js';

const dec = new TextDecoder();
const REF_RE = /\$\{credentialRef:([^}]+)\}/g;

export interface CredentialRefUse {
  path: string;
  ref: string;
}

/** Locate every ${credentialRef:<ref>} placeholder across all files (except signature.json). */
export function findCredentialRefs(bundle: Bundle): CredentialRefUse[] {
  const uses: CredentialRefUse[] = [];
  for (const [path, bytes] of bundle.entries()) {
    if (path === PATHS.signature) continue;
    const text = dec.decode(bytes);
    for (const m of text.matchAll(REF_RE)) uses.push({ path, ref: m[1] });
  }
  return uses;
}

/** Replace ${credentialRef:<ref>} with resolved values; unknown refs are left untouched. */
export function resolvePlaceholders(value: string, resolved: Record<string, string>): string {
  return value.replace(REF_RE, (whole, ref: string) =>
    Object.prototype.hasOwnProperty.call(resolved, ref) ? resolved[ref] : whole,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/secret-refs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Stage (do not commit yet)**

```bash
git add packages/core/src/secret-refs.ts packages/core/test/secret-refs.test.ts
```

---

### Task 9: Public exports + full gate + status update

**Files:**

- Modify: `packages/core/src/index.ts`
- Modify: `CLAUDE.md` (status line)
- Test: `packages/core/test/index.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as core from '../src/index';

describe('public API', () => {
  it('re-exports the engine surface', () => {
    for (const name of [
      'Bundle',
      'PATHS',
      'canonicalDigest',
      'scanForSecrets',
      'validateBundle',
      'assertValid',
      'generateKeypair',
      'sign',
      'verify',
      'pack',
      'unpack',
      'readDir',
      'writeDir',
      'findCredentialRefs',
      'resolvePlaceholders',
      'SecretScanError',
      'BundleValidationError',
      'BundleFormatError',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @uniqent/core exec vitest run test/index.test.ts`
Expected: FAIL (most properties missing — index only re-exports errors so far).

- [ ] **Step 3: Complete the public exports**

Replace `packages/core/src/index.ts` with:

```ts
/**
 * @uniqent/core — read/write, validate, secret-scan, digest, and sign .uniqent bundles.
 */
export * from './errors.js';
export * from './bundle.js';
export * from './digest.js';
export * from './secret-scan.js';
export * from './validate.js';
export * from './signing.js';
export * from './archive.js';
export * from './secret-refs.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @uniqent/core exec vitest run test/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full repo gate**

Run:

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm format:check
```

Expected: all green across `@uniqent/spec` and `@uniqent/core`. If `format:check` flags new files, run `pnpm format` and re-check.

- [ ] **Step 6: Update the status line in CLAUDE.md**

In `CLAUDE.md` under `## Current status`, replace the first sentence so it reads:

```md
**M1 complete.** `packages/spec` and `packages/core` are implemented — bundle model, canonical
digest, fail-closed secret-scan, validation, Ed25519 sign/verify, archive + directory I/O, and
credential-ref helpers, all tested. **Next: M2 (builder engine), then M3 (Uniqent Studio).**
```

- [ ] **Step 7: Squash-commit all of M1 as one feature commit**

```bash
git add -A
git commit -m "feat: M1 core engine (@uniqent/core) + MemoryItem.visibility

Add @uniqent/core: Bundle model, canonical content digest, fail-closed
secret-scan, validation (schema + layout + cross-refs), Ed25519 sign/verify,
archive + directory I/O, and credentialRef helpers. Add MemoryItem.visibility
to the spec and regenerate the JSON Schema + SPEC.md. All tested; M1
acceptance met.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage:** Bundle model (Task 2) ✓; canonical digest (Task 3) ✓; secret-scan with pubkey/signature allowlist (Task 4) ✓; validate schema+layout+cross-ref+secret-scan (Task 5) ✓; Ed25519 sign/verify (Task 6) ✓; archive + dir I/O (Task 7) ✓; secret-ref helpers (Task 8) ✓; `MemoryItem.visibility` spec change + regen (Task 0) ✓; typed errors (Task 1) ✓; public exports (Task 9) ✓. All four M1 acceptance criteria are exercised: byte-stable round-trip (Task 7), reject embedded `sk-` key (Tasks 5 & 6 & 7), tamper-after-sign fails verify (Task 6), visibility added + drift test green (Task 0).

**Placeholder scan:** No "TBD"/"handle errors"/"similar to" — every code step shows complete code.

**Type consistency:** `Bundle` API (`set/get/getText/has/delete/list/entries`, accessors), `PATHS`, `SecretFinding {path,kind,snippet}`, `Issue {path?,code,message}`, `ValidationResult {ok,errors,warnings}`, `VerifyResult {signed,valid,reason?,publicKey?}`, `Keypair {privateKey,publicKey}`, and error classes (`SecretScanError.findings`, `BundleValidationError.issues`) are used identically across tasks. `errors.ts` uses `import type` for `SecretFinding`/`Issue` to avoid a runtime cycle.
