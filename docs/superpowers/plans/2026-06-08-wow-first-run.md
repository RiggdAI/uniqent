# Wow First-Run (`npx @uniqent/cli try <brain>`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a one-command `npx @uniqent/cli try research-analyst` that auto-detects the user's framework, installs a signed, creds-free, memory-rich research brain into it, and ends with a concrete prompt to try.

**Architecture:** A new thin `try` CLI command reuses the existing install pipeline (extracted into a shared `runInstall` helper). Framework auto-detection (`detectTarget`) and the featured-brain catalog (`featuredBrains`) live in `@uniqent/builder`. Featured brains ship as pre-packed, signed `.uniqent` files baked into the CLI package. The `research-analyst` example is enriched in place, and the manifest gains an optional `suggestedPrompts` field.

**Tech Stack:** TypeScript (ESM), pnpm workspaces, zod + zod-to-json-schema (spec), vitest, `@uniqent/core` (pack/sign/verify), `@noble/ed25519`.

---

## File Structure

**Create:**

- `packages/builder/src/featured.ts` — featured-brain catalog (name, displayName, pitch, suggestedPrompts).
- `packages/builder/src/detect.ts` — `detectTarget()` filesystem probe for the user's framework.
- `packages/builder/test/featured.test.ts` — featured catalog tests.
- `packages/builder/test/detect.test.ts` — detection tests.
- `packages/cli/src/featured.ts` — loads `featured/<name>.uniqent` bytes from the CLI package.
- `packages/cli/scripts/build-featured.ts` — packs+signs example brains into `packages/cli/featured/`.
- `packages/cli/test/try.test.ts` — `try` command tests.
- `docs/img/try-demo.svg` — committed terminal-card demo asset for the README.

**Modify:**

- `packages/spec/src/manifest.ts` — add optional `suggestedPrompts`.
- `packages/builder/src/index.ts` — export `featured.js` + `detect.js`.
- `examples/research-analyst/identity/persona.md` — richer persona.
- `examples/research-analyst/memory/facts.jsonl` — ~12 linked facts.
- `examples/research-analyst/skills/summarize/SKILL.md` — enriched skill.
- `examples/research-analyst/uniqent.json` — `suggestedPrompts`, bumped counts.
- `packages/cli/src/run.ts` — extract `runInstall`, add `try` command + help.
- `packages/cli/package.json` — `files` += `featured`; add `build:featured` script + `@uniqent/spec`? (no) — add build dependency on builder (already present).
- `packages/cli/test/examples.test.ts` — assert enriched memory + `suggestedPrompts`.
- `README.md` — lead with the `try` command + demo asset.

---

## Task 1: Spec — add `suggestedPrompts` to the manifest

**Files:**

- Modify: `packages/spec/src/manifest.ts:37-53`
- Test: `packages/spec/test/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/spec/test/manifest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Manifest } from '../src/manifest.js';

describe('suggestedPrompts', () => {
  const base = {
    specVersion: '0.1',
    name: 'research-analyst',
    displayName: 'Research Analyst',
    version: '0.1.0',
    description: 'x',
    author: { name: 'Uniqent' },
    license: 'CC0-1.0',
    tags: ['research'],
    components: {
      identity: true,
      memory: { facts: 12, episodic: 0, hasProfile: false },
      skills: ['summarize'],
      mcp: ['fetch'],
      tools: [],
      tasks: [],
      channels: [],
    },
    credentials: [],
    permissions: {
      filesystem: { read: [], write: [] },
      network: { endpoints: [] },
      autonomy: 'suggest',
      spawnsProcesses: true,
    },
    compatibility: { targets: ['claude-code'] },
  };

  it('accepts a suggestedPrompts array', () => {
    const m = Manifest.parse({ ...base, suggestedPrompts: ['Research X and cite every claim.'] });
    expect(m.suggestedPrompts).toEqual(['Research X and cite every claim.']);
  });

  it('is optional', () => {
    expect(Manifest.parse(base).suggestedPrompts).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/spec/test/manifest.test.ts -t suggestedPrompts`
Expected: FAIL (`suggestedPrompts` stripped/undefined on the first assertion).

- [ ] **Step 3: Add the field**

In `packages/spec/src/manifest.ts`, inside `Manifest = z.object({ … })`, add after `compatibility: Compatibility,`:

```ts
  /** Demo prompts the brain advertises — shown after install ("now ask it this"). */
  suggestedPrompts: z.array(z.string()).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/spec/test/manifest.test.ts -t suggestedPrompts`
Expected: PASS.

- [ ] **Step 5: Regenerate JSON Schema + SPEC.md**

Run: `pnpm --filter @uniqent/spec gen`
Expected: `packages/spec`'s generated JSON Schema + `docs/SPEC.md` updated to include `suggestedPrompts`. Verify with `git diff --stat`.

- [ ] **Step 6: Commit**

```bash
git add packages/spec docs/SPEC.md
git commit -m "feat(spec): add optional suggestedPrompts to the manifest"
```

---

## Task 2: builder — `featuredBrains()` catalog

**Files:**

- Create: `packages/builder/src/featured.ts`
- Modify: `packages/builder/src/index.ts:4-9`
- Test: `packages/builder/test/featured.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/test/featured.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { featuredBrains, findFeatured } from '../src/featured.js';

describe('featuredBrains', () => {
  it('includes research-analyst with a pitch and a suggested prompt', () => {
    const ra = featuredBrains().find((b) => b.name === 'research-analyst');
    expect(ra).toBeDefined();
    expect(ra!.pitch.length).toBeGreaterThan(10);
    expect(ra!.suggestedPrompts.length).toBeGreaterThan(0);
  });

  it('findFeatured returns undefined for unknown names', () => {
    expect(findFeatured('nope')).toBeUndefined();
    expect(findFeatured('research-analyst')?.displayName).toBe('Research Analyst');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/builder/test/featured.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the catalog**

Create `packages/builder/src/featured.ts`:

```ts
/** A brain promoted in `uniqent try` and (later) Studio's gallery. */
export interface FeaturedBrain {
  /** Slug — also the example source dir and the featured `.uniqent` filename. */
  name: string;
  displayName: string;
  /** One-line pitch shown in `try --list`. */
  pitch: string;
  /** Demo prompts shown after install. */
  suggestedPrompts: string[];
}

export const FEATURED_BRAINS: FeaturedBrain[] = [
  {
    name: 'research-analyst',
    displayName: 'Research Analyst',
    pitch: 'Fetches primary sources and writes faithful, fully-cited summaries. No API key needed.',
    suggestedPrompts: [
      'Research the best vector database for a RAG app and cite every claim.',
      'Summarize the current state of small open-weight LLMs, with sources.',
    ],
  },
];

export function featuredBrains(): FeaturedBrain[] {
  return FEATURED_BRAINS;
}

export function findFeatured(name: string): FeaturedBrain | undefined {
  return FEATURED_BRAINS.find((b) => b.name === name);
}
```

- [ ] **Step 4: Export from the builder index**

In `packages/builder/src/index.ts`, add:

```ts
export * from './featured.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/builder/test/featured.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/builder/src/featured.ts packages/builder/src/index.ts packages/builder/test/featured.test.ts
git commit -m "feat(builder): featured-brain catalog"
```

---

## Task 3: builder — `detectTarget()` framework probe

**Files:**

- Create: `packages/builder/src/detect.ts`
- Modify: `packages/builder/src/index.ts`
- Test: `packages/builder/test/detect.test.ts`

> **Why a custom probe:** all three adapters' `detect()` are stubs returning `present: true`, so they cannot route. `detectTarget` probes the filesystem directly. Priority: claude-code → openclaw → hermes. For claude-code the install root is always the project cwd (so the demo folder is self-contained), even when only `~/.claude` exists.

- [ ] **Step 1: Write the failing test**

Create `packages/builder/test/detect.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectTarget } from '../src/detect.js';

let cwd: string;
let home: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), 'uq-cwd-'));
  home = await mkdtemp(join(tmpdir(), 'uq-home-'));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe('detectTarget', () => {
  it('detects claude-code from a project .claude dir, root = cwd', async () => {
    await mkdir(join(cwd, '.claude'));
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({
      id: 'claude-code',
      configRoot: cwd,
    });
  });

  it('detects claude-code from ~/.claude but still installs into cwd', async () => {
    await mkdir(join(home, '.claude'));
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({
      id: 'claude-code',
      configRoot: cwd,
    });
  });

  it('detects openclaw from OPENCLAW_STATE_DIR', async () => {
    expect(await detectTarget({ cwd, home, env: { OPENCLAW_STATE_DIR: '/tmp/oc' } })).toEqual({
      id: 'openclaw',
      configRoot: '/tmp/oc',
    });
  });

  it('detects hermes from a hermes.json', async () => {
    await writeFile(join(cwd, 'hermes.json'), '{}');
    expect(await detectTarget({ cwd, home, env: {} })).toEqual({ id: 'hermes', configRoot: cwd });
  });

  it('returns null when nothing is found', async () => {
    expect(await detectTarget({ cwd, home, env: {} })).toBeNull();
  });

  it('prefers claude-code over hermes when both markers exist', async () => {
    await mkdir(join(cwd, '.claude'));
    await writeFile(join(cwd, 'hermes.json'), '{}');
    expect((await detectTarget({ cwd, home, env: {} }))!.id).toBe('claude-code');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/builder/test/detect.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the probe**

Create `packages/builder/src/detect.ts`:

```ts
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export type TargetId = 'claude-code' | 'openclaw' | 'hermes';

export interface TargetGuess {
  id: TargetId;
  /** The framework project root to install into. */
  configRoot: string;
}

export interface DetectInput {
  cwd: string;
  home: string;
  env?: Record<string, string | undefined>;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe the machine for a known agent framework. Priority claude-code → openclaw → hermes.
 * Returns null if none is found (caller defaults to claude-code in cwd and says so).
 */
export async function detectTarget(input: DetectInput): Promise<TargetGuess | null> {
  const env = input.env ?? {};

  // Claude Code: a .claude dir in the project or in $HOME. Install root is always cwd.
  if ((await exists(join(input.cwd, '.claude'))) || (await exists(join(input.home, '.claude')))) {
    return { id: 'claude-code', configRoot: input.cwd };
  }

  // OpenClaw: explicit state dir, or an openclaw.json in cwd.
  if (env.OPENCLAW_STATE_DIR) return { id: 'openclaw', configRoot: env.OPENCLAW_STATE_DIR };
  if (await exists(join(input.cwd, 'openclaw.json')))
    return { id: 'openclaw', configRoot: input.cwd };

  // Hermes: a hermes.json in cwd, or ~/.hermes.
  if (await exists(join(input.cwd, 'hermes.json'))) return { id: 'hermes', configRoot: input.cwd };
  if (await exists(join(input.home, '.hermes'))) return { id: 'hermes', configRoot: input.home };

  return null;
}
```

- [ ] **Step 4: Export from the builder index**

In `packages/builder/src/index.ts`, add:

```ts
export * from './detect.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/builder/test/detect.test.ts`
Expected: PASS (all 6).

- [ ] **Step 6: Commit**

```bash
git add packages/builder/src/detect.ts packages/builder/src/index.ts packages/builder/test/detect.test.ts
git commit -m "feat(builder): detectTarget framework probe"
```

---

## Task 4: Enrich the `research-analyst` hero brain

**Files:**

- Modify: `examples/research-analyst/identity/persona.md`
- Modify: `examples/research-analyst/memory/facts.jsonl`
- Modify: `examples/research-analyst/skills/summarize/SKILL.md`
- Modify: `examples/research-analyst/uniqent.json`
- Test: `packages/cli/test/examples.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the body of `packages/cli/test/examples.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readDir, validateBundle, pack } from '@uniqent/core';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '../../../examples');

describe('example bundles', () => {
  for (const name of ['dev-powerpack', 'research-analyst', 'personal-assistant']) {
    it(`${name} validates and packs (no secrets)`, async () => {
      const bundle = await readDir(resolve(examplesDir, name));
      expect(validateBundle(bundle).ok).toBe(true);
      const bytes = await pack(bundle); // throws if the secret-scan trips
      expect(bytes.length).toBeGreaterThan(0);
    });
  }

  it('research-analyst is a rich hero: ≥10 facts, creds-free, has suggestedPrompts', async () => {
    const bundle = await readDir(resolve(examplesDir, 'research-analyst'));
    const m = JSON.parse(new TextDecoder().decode(bundle.get('uniqent.json')!));
    expect(m.components.memory.facts).toBeGreaterThanOrEqual(10);
    expect(m.credentials).toEqual([]);
    expect(Array.isArray(m.suggestedPrompts)).toBe(true);
    expect(m.suggestedPrompts[0]).toMatch(/cite/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cli/test/examples.test.ts -t "rich hero"`
Expected: FAIL (`facts` is 1, no `suggestedPrompts`).

- [ ] **Step 3: Enrich the persona**

Replace `examples/research-analyst/identity/persona.md` with:

```markdown
# Persona

You are a meticulous research analyst. You exist to turn an open question into a faithful,
well-sourced answer — never a confident guess.

How you work:

- **Fetch primary sources first.** Prefer the original paper, doc, or dataset over a summary of it.
- **Quote precisely and cite everything.** Every non-obvious claim gets a source. If you can't
  source it, you say so rather than assert it.
- **Separate fact from inference.** Mark what the source says vs. what you're concluding.
- **Flag uncertainty out loud.** Conflicting sources, thin evidence, or stale data get called out.
- **Be concise.** A tight, cited summary beats a long, hedged one.

You would rather return "I couldn't verify this" than invent a plausible answer.
```

- [ ] **Step 4: Enrich the memory (≥10 linked facts)**

Replace `examples/research-analyst/memory/facts.jsonl` with the following (one JSON object per line, no trailing blank line). Note the Obsidian `[[entities]]` and `#tags` that make the memory-brain graph rich. **No secrets** — all are methodology notes:

```jsonl
{"id":"f1","kind":"preference","text":"Wants a citation for every non-obvious claim, linked inline. #citations","createdAt":"2026-05-31T00:00:00.000Z","importance":0.95,"visibility":"shareable"}
{"id":"f2","kind":"preference","text":"Prefers [[primary-sources]] over secondary summaries; quote the original. #methodology","createdAt":"2026-05-31T00:00:00.000Z","importance":0.9,"visibility":"shareable"}
{"id":"f3","kind":"decision","text":"Default summary shape: TL;DR, then key findings, then [[open-questions]]. #format","createdAt":"2026-05-31T00:00:00.000Z","importance":0.8,"visibility":"shareable"}
{"id":"f4","kind":"fact","text":"[[arXiv]] is the go-to for AI/ML preprints; check the latest version, not v1. #sources","createdAt":"2026-05-31T00:00:00.000Z","importance":0.7,"visibility":"shareable"}
{"id":"f5","kind":"preference","text":"Flag [[conflicting-sources]] explicitly instead of silently picking one. #methodology #uncertainty","createdAt":"2026-05-31T00:00:00.000Z","importance":0.85,"visibility":"shareable"}
{"id":"f6","kind":"fact","text":"Distinguish a [[benchmark]] result from a vendor's marketing claim. #methodology","createdAt":"2026-05-31T00:00:00.000Z","importance":0.75,"visibility":"shareable"}
{"id":"f7","kind":"preference","text":"Note the publication date; flag anything older than ~18 months as possibly stale. #freshness","createdAt":"2026-05-31T00:00:00.000Z","importance":0.7,"visibility":"shareable"}
{"id":"f8","kind":"decision","text":"When sources disagree, present both and explain the [[trade-offs]]. #methodology","createdAt":"2026-05-31T00:00:00.000Z","importance":0.8,"visibility":"shareable"}
{"id":"f9","kind":"fact","text":"[[peer-review]] status matters: preprint vs. published vs. blog post is worth stating. #sources","createdAt":"2026-05-31T00:00:00.000Z","importance":0.65,"visibility":"shareable"}
{"id":"f10","kind":"preference","text":"Separate what the [[source]] says from your own inference, label each. #methodology","createdAt":"2026-05-31T00:00:00.000Z","importance":0.85,"visibility":"shareable"}
{"id":"f11","kind":"milestone","text":"Adopted the [[summarize]] skill as the default research-to-writeup workflow. #format","createdAt":"2026-05-31T00:00:00.000Z","importance":0.6,"visibility":"shareable"}
{"id":"f12","kind":"fact","text":"For numeric claims, prefer the [[dataset]] or table over a prose restatement. #methodology","createdAt":"2026-05-31T00:00:00.000Z","importance":0.7,"visibility":"shareable"}
```

- [ ] **Step 5: Enrich the summarize skill**

Replace `examples/research-analyst/skills/summarize/SKILL.md` with:

```markdown
---
name: summarize
description: Use when asked to research a topic or summarize sources — fetch primary sources, quote precisely, cite every claim, and flag uncertainty.
---

# Summarize (faithful, cited)

When the user asks you to research or summarize:

1. **Gather sources.** Fetch the primary sources with the web-fetch MCP. Prefer originals
   (papers, docs, datasets) over second-hand summaries.
2. **Read before writing.** Pull the actual claims and numbers; do not summarize from the title.
3. **Write the summary** in this shape:
   - **TL;DR** — 1–2 sentences.
   - **Key findings** — bullets, each with an inline citation to the source it came from.
   - **Open questions / caveats** — conflicting sources, thin evidence, stale data.
4. **Cite everything non-obvious.** If a claim has no source, say "unverified" rather than asserting it.
5. **Separate fact from inference.** Label what the source says vs. what you concluded.

Never invent a citation. A missing source is information — report it.
```

- [ ] **Step 6: Update the manifest**

Replace `examples/research-analyst/uniqent.json` with (bumped `memory.facts`, added `suggestedPrompts`; everything else unchanged):

```json
{
  "specVersion": "0.1",
  "name": "research-analyst",
  "displayName": "Research Analyst",
  "version": "0.1.0",
  "description": "A web-research agent that fetches sources and writes faithful, cited summaries.",
  "author": {
    "name": "Uniqent",
    "url": "https://uniqent.dev"
  },
  "license": "CC0-1.0",
  "tags": ["research", "web"],
  "suggestedPrompts": [
    "Research the best vector database for a RAG app and cite every claim.",
    "Summarize the current state of small open-weight LLMs, with sources."
  ],
  "components": {
    "identity": true,
    "memory": {
      "facts": 12,
      "episodic": 0,
      "hasProfile": false
    },
    "skills": ["summarize"],
    "mcp": ["fetch"],
    "tools": [],
    "tasks": [],
    "channels": []
  },
  "credentials": [],
  "permissions": {
    "filesystem": {
      "read": [],
      "write": []
    },
    "network": {
      "endpoints": []
    },
    "autonomy": "suggest",
    "spawnsProcesses": true
  },
  "compatibility": {
    "targets": ["claude-code", "hermes", "openclaw"]
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run packages/cli/test/examples.test.ts`
Expected: PASS — all three example bundles validate/pack, and the "rich hero" assertions pass.

- [ ] **Step 8: Commit**

```bash
git add examples/research-analyst packages/cli/test/examples.test.ts
git commit -m "feat(examples): enrich research-analyst into the wow hero (12 linked facts, suggestedPrompts)"
```

---

## Task 5: CLI — `build:featured` script + featured loader

**Files:**

- Create: `packages/cli/scripts/build-featured.ts`
- Create: `packages/cli/src/featured.ts`
- Modify: `packages/cli/package.json`
- Test: `packages/cli/test/try.test.ts` (featured-loading portion)

> The script packs+signs each featured example into `packages/cli/featured/<name>.uniqent`. `sign()` uses a fresh keypair each run; `verify()` checks the signature against the pubkey embedded in `signature.json`, so the bundle shows "valid ✓" without any committed key.

- [ ] **Step 1: Add the build:featured script + featured to files**

In `packages/cli/package.json`:

- Add `"featured"` to the `files` array: `"files": ["dist", "featured"]`.
- Add to `scripts`: `"build:featured": "node --experimental-strip-types scripts/build-featured.ts"`.
- In `scripts.build`, chain it so a normal build produces the bundles:
  `"build": "tsc -p tsconfig.json && node --experimental-strip-types scripts/build-featured.ts"`.

> Node 22.13 supports `--experimental-strip-types` for running a `.ts` script directly. If the repo already runs TS scripts another way (check `packages/spec/scripts/gen.ts`'s invocation in `packages/spec/package.json`), mirror that exact invocation instead.

- [ ] **Step 2: Implement the build script**

Create `packages/cli/scripts/build-featured.ts`:

```ts
import { readDir, pack, sign, generateKeypair } from '@uniqent/core';
import { featuredBrains } from '@uniqent/builder';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/scripts
const examplesDir = resolve(here, '../../../examples');
const outDir = resolve(here, '../featured');

const kp = await generateKeypair();
await mkdir(outDir, { recursive: true });

for (const b of featuredBrains()) {
  const bundle = await readDir(join(examplesDir, b.name));
  const signed = await sign(bundle, kp.privateKey); // runs the secret-scan gate
  const bytes = await pack(signed);
  await writeFile(join(outDir, `${b.name}.uniqent`), bytes);
  console.log(`featured: ${b.name}.uniqent (${bytes.length} bytes)`);
}
```

- [ ] **Step 3: Build the featured bundles**

Run: `pnpm --filter @uniqent/builder build && pnpm --filter @uniqent/core build && pnpm --filter @uniqent/cli build:featured`
Expected: prints `featured: research-analyst.uniqent (NNNN bytes)` and creates `packages/cli/featured/research-analyst.uniqent`.

- [ ] **Step 4: Add the featured loader (with a fallback to source-pack for tests)**

Create `packages/cli/src/featured.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { unpack, readDir, pack } from '@uniqent/core';
import type { Bundle } from '@uniqent/core';

const here = dirname(fileURLToPath(import.meta.url)); // packages/cli/dist (built) or src (ts)

/** Dir holding pre-packed featured `.uniqent` files shipped with the package. */
function featuredDir(): string {
  return resolve(here, '..', 'featured');
}

/**
 * Load a featured brain's bundle. Prefers the pre-packed signed file shipped in the package;
 * falls back to packing the example source dir (used in tests / before build:featured runs).
 */
export async function loadFeaturedBundle(name: string): Promise<Bundle> {
  const packed = join(featuredDir(), `${name}.uniqent`);
  try {
    return unpack(new Uint8Array(await readFile(packed)));
  } catch {
    const src = resolve(here, '..', '..', '..', 'examples', name);
    return pack(await readDir(src)).then((bytes) => unpack(bytes));
  }
}
```

- [ ] **Step 5: Write the failing test for the loader**

Create `packages/cli/test/try.test.ts` (loader portion first):

```ts
import { describe, it, expect } from 'vitest';
import { loadFeaturedBundle } from '../src/featured.js';

describe('loadFeaturedBundle', () => {
  it('loads research-analyst as an unpackable bundle', async () => {
    const bundle = await loadFeaturedBundle('research-analyst');
    const manifest = bundle.get('uniqent.json');
    expect(manifest).toBeDefined();
    const m = JSON.parse(new TextDecoder().decode(manifest!));
    expect(m.name).toBe('research-analyst');
  });
});
```

- [ ] **Step 6: Run the loader test**

Run: `pnpm --filter @uniqent/cli build && pnpm vitest run packages/cli/test/try.test.ts -t loadFeaturedBundle`
Expected: PASS (loads the pre-packed file, or falls back to source-pack).

- [ ] **Step 7: Ignore the built featured dir in git**

Add to `.gitignore`:

```
packages/cli/featured/
```

> The featured bundles are build artifacts (regenerated on `build:featured`, and at publish via the chained `build`). They are not committed; CI/`prepublishOnly` regenerates them.

- [ ] **Step 8: Ensure publish regenerates featured**

In `packages/cli/package.json` add:

```json
"prepublishOnly": "pnpm build"
```

(so `npm publish` always re-runs `tsc` + `build:featured`, guaranteeing `featured/` is present in the tarball).

- [ ] **Step 9: Commit**

```bash
git add packages/cli/scripts/build-featured.ts packages/cli/src/featured.ts packages/cli/package.json packages/cli/test/try.test.ts .gitignore
git commit -m "feat(cli): pack+sign featured brains into the package + loader"
```

---

## Task 6: CLI — extract `runInstall`, add the `try` command

**Files:**

- Modify: `packages/cli/src/run.ts` (extract shared helper from `install` at 156-238; add `tryCmd`; wire dispatch at 686-712)
- Test: `packages/cli/test/try.test.ts`

- [ ] **Step 1: Extract `runInstall` from `install`**

In `packages/cli/src/run.ts`, add a shared helper that takes an already-resolved bundle. Place it above `install`:

```ts
interface RunInstallOpts {
  target: string;
  root: string;
  creds: Record<string, string>;
  allowUnsigned: boolean;
  autoYes: boolean;
  dryRun: boolean;
}

/** Shared verify → plan → resolve creds → confirm → apply pipeline for `install` and `try`. */
async function runInstall(bundle: Bundle, opts: RunInstallOpts, io: CliIo): Promise<number> {
  const adapter = ADAPTERS[opts.target];
  if (!adapter) {
    io.error(`unknown target "${opts.target}" (available: ${Object.keys(ADAPTERS).join(', ')})`);
    return 1;
  }

  const v = await verify(bundle);
  if (!v.signed || !v.valid) {
    if (!opts.allowUnsigned) {
      io.error(
        `bundle is ${v.signed ? 'INVALID (tampered)' : 'unsigned'}; refusing. Pass --allow-unsigned to override.`,
      );
      return 1;
    }
    io.log(
      `WARNING: installing an ${v.signed ? 'INVALID' : 'unsigned'} bundle (--allow-unsigned).`,
    );
  } else {
    io.log('signature: valid ✓');
  }

  const plan = await adapter.plan(bundle, { root: opts.root });
  io.log(`\nPlan — ${adapter.displayName} at ${opts.root}:`);
  for (const w of plan.writes) io.log(`  write ${w.path}  (${w.summary})`);
  if (plan.lossiness.length > 0) {
    io.log('lossiness:');
    for (const l of plan.lossiness) io.log(`  ${l.action}: ${l.component} — ${l.issue}`);
  }

  if (opts.dryRun) {
    if (plan.requiresCredentials.length > 0)
      io.log(`requires credentials: ${plan.requiresCredentials.join(', ')}`);
    io.log('\ndry run — nothing written.');
    return 0;
  }

  const resolved: ResolvedCredentials = {};
  for (const ref of plan.requiresCredentials) {
    let value = opts.creds[ref] ?? process.env[`UNIQENT_CRED_${ref.toUpperCase()}`];
    if (!value && io.prompt) value = await io.prompt(`credential "${ref}": `);
    if (!value) {
      io.error(`missing credential "${ref}" (pass --cred ${ref}=<value>)`);
      return 1;
    }
    resolved[ref] = value;
  }

  if (!opts.autoYes && io.prompt) {
    const ans = await io.prompt('Proceed with install? [y/N] ');
    if (ans.trim().toLowerCase() !== 'y') {
      io.log('aborted.');
      return 1;
    }
  }

  const result = await adapter.apply(bundle, plan, resolved, { root: opts.root });
  io.log(`\nInstalled into ${opts.root}:`);
  for (const w of result.written) io.log(`  ${w}`);
  for (const n of result.notes) io.log(`  note: ${n}`);
  return 0;
}
```

- [ ] **Step 2: Rewrite `install` to use `runInstall`**

Replace the body of `install` (everything after `parseArgs`) with resolution + delegation:

```ts
async function install(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags, creds } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    io.error('install: missing <file.uniqent|url|slug>');
    return 1;
  }
  const target = typeof flags.target === 'string' ? flags.target : 'claude-code';
  const root = typeof flags.root === 'string' ? flags.root : process.cwd();
  let bundle: Bundle;
  try {
    bundle = await resolveBundle(file, flags);
  } catch (e) {
    io.error(`install: ${(e as Error).message}`);
    return 1;
  }
  const code = await runInstall(
    bundle,
    {
      target,
      root,
      creds,
      allowUnsigned: flags['allow-unsigned'] === true,
      autoYes: flags.yes === true,
      dryRun: flags['dry-run'] === true,
    },
    io,
  );
  if (code === 0 && !flags['dry-run']) io.log('\nDone. Open the project in Claude Code.');
  return code;
}
```

- [ ] **Step 3: Run existing install tests to confirm no regression**

Run: `pnpm --filter @uniqent/cli test`
Expected: existing install tests PASS unchanged (same writes/messages).

- [ ] **Step 4: Write the failing `try` test**

Add to `packages/cli/test/try.test.ts`:

```ts
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../src/run.js';

function collectIo() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { log: (m: string) => out.push(m), error: (m: string) => err.push(m) },
    out,
    err,
  };
}

describe('uniqent try', () => {
  it('--list prints featured brains', async () => {
    const { io, out } = collectIo();
    const code = await run(['try', '--list'], io);
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/research-analyst/);
  });

  it('installs research-analyst into a detected claude-code root and prints a suggested prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'uq-try-'));
    await mkdir(join(root, '.claude')); // makes detectTarget pick claude-code @ root
    const { io, out } = collectIo();
    const code = await run(['try', 'research-analyst', '--root', root, '--yes'], io);
    expect(code).toBe(0);
    const log = out.join('\n');
    expect(log).toMatch(/Research Analyst/);
    expect(log).toMatch(/signature: valid/);
    expect(log).toMatch(/cite every claim/i); // the suggested prompt payoff
    const written = await readdir(join(root, '.claude'), { recursive: true } as never);
    expect(written.length).toBeGreaterThan(0);
    await rm(root, { recursive: true, force: true });
  });

  it('unknown brain lists featured and exits non-zero', async () => {
    const { io, err } = collectIo();
    const code = await run(['try', 'no-such-brain'], io);
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/research-analyst/);
  });
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter @uniqent/cli build && pnpm vitest run packages/cli/test/try.test.ts -t "uniqent try"`
Expected: FAIL (`try` not dispatched → usage error / non-zero).

- [ ] **Step 6: Implement `tryCmd`**

Add to `packages/cli/src/run.ts` (import `findFeatured`, `featuredBrains`, `detectTarget` from `@uniqent/builder`, and `loadFeaturedBundle` from `./featured.js` at the top):

```ts
import { homedir } from 'node:os';
import { findFeatured, featuredBrains, detectTarget } from '@uniqent/builder';
import { loadFeaturedBundle } from './featured.js';

function printFeatured(io: CliIo): void {
  io.log('Featured brains you can try:');
  for (const b of featuredBrains()) io.log(`  ${b.name} — ${b.pitch}`);
  io.log('\n  uniqent try <name>');
}

async function tryCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags, creds } = parseArgs(args);

  if (flags.list === true) {
    printFeatured(io);
    return 0;
  }

  const name = positionals[0];
  if (!name) {
    io.error('try: missing <brain>');
    printFeatured(io);
    return 1;
  }

  const featured = findFeatured(name);
  let bundle: Bundle;
  try {
    bundle = featured ? await loadFeaturedBundle(name) : await resolveBundle(name, flags);
  } catch (e) {
    io.error(`try: couldn't load "${name}": ${(e as Error).message}`);
    if (!featured) printFeatured(io);
    return 1;
  }

  // Resolve target + root: explicit flags win, else auto-detect, else default claude-code in cwd.
  let target = typeof flags.target === 'string' ? flags.target : undefined;
  let root = typeof flags.root === 'string' ? flags.root : undefined;
  if (!target || !root) {
    const guess = await detectTarget({
      cwd: root ?? process.cwd(),
      home: homedir(),
      env: process.env,
    });
    if (guess) {
      target ??= guess.id;
      root ??= guess.configRoot;
      io.log(`detected: ${ADAPTERS[guess.id]?.displayName ?? guess.id} (${guess.configRoot})`);
    } else {
      target ??= 'claude-code';
      root ??= process.cwd();
      io.log(
        `no agent detected — setting up ${ADAPTERS[target]?.displayName ?? target} in ${root}`,
      );
    }
  }

  const code = await runInstall(
    bundle,
    {
      target,
      root,
      creds,
      allowUnsigned: flags['allow-unsigned'] === true,
      autoYes: flags.yes === true,
      dryRun: flags['dry-run'] === true,
    },
    io,
  );
  if (code !== 0 || flags['dry-run']) return code;

  // The payoff: surface the brain's suggested prompts.
  const manifest = bundle.get('uniqent.json');
  const prompts: string[] = manifest
    ? (JSON.parse(new TextDecoder().decode(manifest)).suggestedPrompts ?? [])
    : [];
  io.log(`\nDone. Open this folder in ${ADAPTERS[target]?.displayName ?? target} and ask:`);
  if (prompts.length) for (const p of prompts) io.log(`  → "${p}"`);
  else io.log('  → ask it anything in its wheelhouse.');
  return 0;
}
```

- [ ] **Step 7: Add `list` to BOOLEAN_FLAGS and wire dispatch + help**

In `packages/cli/src/run.ts`:

- Add `'list'` to `BOOLEAN_FLAGS`: `const BOOLEAN_FLAGS = new Set(['yes', 'allow-unsigned', 'json', 'sign', 'dry-run', 'list']);`
- In `run()`, add before the usage error: `if (cmd === 'try') return tryCmd(rest, io);`
- Add `try` to the usage line and a help line:

```ts
io.error(
  'usage: uniqent <try|inspect|install|validate|pack|search|hub|export|import-vault|publish-memory|keygen|sign> …',
);
io.error(
  '  try <brain> [--target <id>] [--root <dir>] [--yes] [--list]   (one-command install of a featured brain)',
);
```

- [ ] **Step 8: Run the `try` tests to verify they pass**

Run: `pnpm --filter @uniqent/cli build && pnpm vitest run packages/cli/test/try.test.ts`
Expected: PASS (loader + `--list` + install-into-detected-root + unknown-brain).

- [ ] **Step 9: Run the full CLI suite**

Run: `pnpm --filter @uniqent/cli test`
Expected: all PASS (no install regression).

- [ ] **Step 10: Manual end-to-end**

```bash
pnpm build
TMP=$(mktemp -d) && mkdir "$TMP/.claude"
node packages/cli/dist/bin.js try research-analyst --root "$TMP" --yes
```

Expected: prints `detected: Claude Code`, `signature: valid ✓`, the plan writes, and a `→ "Research the best vector database…"` payoff line; `$TMP/.claude` contains skills + the merged config.

- [ ] **Step 11: Commit**

```bash
git add packages/cli/src/run.ts packages/cli/test/try.test.ts
git commit -m "feat(cli): uniqent try <brain> — auto-detect + one-command install + payoff"
```

---

## Task 7: README restructure (Hermes-style, action-first) + demo asset

**Goal:** Reorder the README so a newcomer sees _what it is_ and _what to type_ in the first
screenful — modeled on the clarity of `nousresearch/hermes-agent` (badge row → 1-paragraph intro →
install command up top → scannable feature blocks → command tables → dividers). Keep every accurate
claim; change ordering and density, not facts.

**Files:**

- Create: `docs/img/try-demo.svg`
- Modify: `README.md` (full restructure)

- [ ] **Step 1: Create the demo asset**

Create `docs/img/try-demo.svg` — a static "terminal card" of the `try` flow (renders on GitHub):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="760" height="300" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="14">
  <rect width="760" height="300" rx="10" fill="#0d1117"/>
  <circle cx="22" cy="22" r="6" fill="#ff5f56"/><circle cx="42" cy="22" r="6" fill="#ffbd2e"/><circle cx="62" cy="22" r="6" fill="#27c93f"/>
  <text x="20" y="70" fill="#7ee787">$ <tspan fill="#e6edf3">npx @uniqent/cli try research-analyst</tspan></text>
  <text x="20" y="100" fill="#8b949e">detected: Claude Code (~/.claude)</text>
  <text x="20" y="124" fill="#8b949e">signature: valid ✓</text>
  <text x="20" y="148" fill="#e6edf3">installing Research Analyst…</text>
  <text x="20" y="172" fill="#58a6ff">  ✓ persona, summarize skill, web-fetch MCP (no API key)</text>
  <text x="20" y="196" fill="#58a6ff">  ✓ 12 memories → knowledge graph</text>
  <text x="20" y="232" fill="#e6edf3">Done. Open this folder in Claude Code and ask:</text>
  <text x="20" y="258" fill="#d2a8ff">  → "Research the best vector database for a RAG app</text>
  <text x="20" y="278" fill="#d2a8ff">     and cite every claim."</text>
</svg>
```

- [ ] **Step 2: Replace `README.md` with the restructured version**

Overwrite `README.md` with the content below. Section order: **hero + badges → 2-sentence intro →
Try it in one command → What is Uniqent? → What you can do → divider → How it works → A "brain" = …
→ Install into any agent → divider → CLI (table) → Studio → Build from source → divider → Docs
table → Status (collapsed) → License → Contributing & Community.**

> Preserve the existing screenshots (`docs/img/studio-canvas.png`, `docs/img/memory-brain.png`,
> `docs/img/memory-brain-3d.png`) — move the memory-brain images into the "What you can do" →
> _Build one visually_ block rather than the top. Keep all repo URLs (`RiggdAI/uniqent`).

````markdown
# Uniqent ☉

[![CI](https://github.com/RiggdAI/uniqent/actions/workflows/ci.yml/badge.svg)](https://github.com/RiggdAI/uniqent/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@uniqent/cli?label=%40uniqent%2Fcli)](https://www.npmjs.com/package/@uniqent/cli)
[![Code: Apache-2.0](https://img.shields.io/badge/code-Apache--2.0-blue)](LICENSE)
[![Spec: CC0](https://img.shields.io/badge/spec-CC0-green)](LICENSE-SPEC)
[![Spec docs](https://img.shields.io/badge/docs-SPEC.md-informational)](docs/SPEC.md)

**Any brain, any agent.** Package an AI agent's whole brain once — persona, MCP stack, skills,
memory, config — into one open, signed `.uniqent` file, and install it into whatever framework you
run (Claude Code, Hermes, OpenClaw) in **one command**.

> Think **n8n, but for whole agents**: a visual builder to assemble the thing, and a portable
> artifact you can install anywhere. Uniqent is the builder + packager + translator + installer — it
> sits _above_ the frameworks so one brain travels between all of them.

## ▶ Try it in one command

No clone, no config, no API key — install a complete research-analyst brain into your agent:

```bash
npx @uniqent/cli try research-analyst
```

![Trying a brain in one command](docs/img/try-demo.svg)

It auto-detects your framework, installs the persona + skill + web-fetch MCP + a linked memory
graph, then tells you exactly what to ask. Run `npx @uniqent/cli try --list` to see the featured
brains.

---

## What is Uniqent?

Today an agent's "brain" is locked inside whatever framework you built it in — there's no portable
unit for "a whole agent." Uniqent makes that unit and the workflow around it: **build → package →
share → install.** You compose a brain in **Uniqent Studio** (a local-first visual builder) — or
capture one you already have — and export a single signed `.uniqent` bundle that **carries no
secrets**. Anyone installs it into the framework they run; a per-framework **adapter** translates
the brain into that framework's native layout and asks only for the recipient's own credentials.

## What you can do

- 🚀 **Try a brain instantly** — `npx @uniqent/cli try <name>` installs a featured, signed,
  creds-free brain into your agent in one command.
- 🧩 **Build one visually** — compose persona, MCP stack, skills, memory, channels, and flows on an
  n8n-style canvas in **Studio**, with credentials wired as "needs" edges, then export one
  `.uniqent`.

  ![Uniqent Studio — the visual brain builder](docs/img/studio-canvas.png)

  Memory isn't a flat list: write facts with Obsidian-style `[[entities]]` and `#tags` and Studio
  parses them into an interactive **memory brain** — a force-directed graph (zoom / pan / drag, plus
  a 3D mode) of how facts, people, and topics connect.

  ![The memory brain — an interactive knowledge graph](docs/img/memory-brain.png)

- 📥 **Bring what you have** — `uniqent export` captures a running agent; `uniqent import-vault`
  turns an Obsidian / "second-brain" vault into a brain (`SOUL.md` → persona, `USER.md` → profile,
  `MEMORY.md` + notes → memory, `[[wikilinks]]`/`#tags` preserved).
- 🔁 **Install anywhere** — the same bundle installs into Claude Code, Hermes, or OpenClaw; the
  adapter translates it and resolves your credentials locally.

---

## How it works

**Build → Pack → Share → Install** — one open bundle, any framework:

1. **Build** a brain in Studio (or capture an existing agent / vault).
2. **Pack + sign** it into a `.uniqent` (Ed25519 signature over a content digest) — a fail-closed
   secret-scan guarantees **no API keys** travel in the bundle.
3. **Share** it as a raw file or URL (e.g. straight from GitHub) — no hosted service required.
4. **Install** it: the adapter verifies the signature, shows a permission sheet, resolves _your_
   credentials locally, dry-runs in a sandbox, then writes the framework's native layout.

What makes it defensible — four things `.dotagents`-style sharing lacks:

- **Install is a translation, not a copy.** One canonical format → per-adapter native output. When a
  target can't hold something (e.g. Hermes' memory limits) it truncates/transforms **and reports
  exactly what changed**. Lossy is acceptable; _silent_ loss is not.
- **Secrets never travel in a bundle.** It carries the wiring (which MCP server, transport, auth
  _type_), never the keys — safe to post publicly and still instantly runnable.
- **No hosted dependency.** Install from a file or URL; a registry is optional convenience.
- **Trust is first-class.** Signing, a permission sheet, a redactable memory preview, and a sandboxed
  dry-run — all in v1.

### A "brain" = everything that makes an agent that agent

| Part             | What it is                                                              |
| ---------------- | ----------------------------------------------------------------------- |
| **Persona**      | personality, voice, role, goals — the identity                          |
| **About**        | a README + avatar describing the brain (travels in the bundle)          |
| **Stacks (MCP)** | the MCP servers it can use (GitHub, filesystem, web, …) and which tools |
| **Skills**       | reusable, cross-agent `SKILL.md` capabilities                           |
| **Memory**       | durable facts, decisions, preferences, a user/agent profile             |
| **Tools**        | native built-ins it has on (web search, browser, code exec, …)          |
| **Automations**  | scheduled/triggered tasks (e.g. a daily briefing)                       |
| **Channels**     | where it's reachable (Telegram, Discord, Slack, …)                      |
| **Config**       | model/provider prefs, autonomy level, allowlists                        |

### Install into any agent

| Framework               | How the brain lands                                                                                     | Status  |
| ----------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| **Claude Code**         | skills → `.claude/skills`, persona+memory → instructions, MCP → `.mcp.json`                             | ✅ v1   |
| **Hermes**              | persona → `SOUL.md`, **bounded** memory (prioritized + trimmed, reported), MCP/channels → `hermes.json` | ✅ v1   |
| **OpenClaw**            | persona → `SOUL.md`, memory → `MEMORY.md`, skills → `skills/`, MCP/channels → `openclaw.json`           | ✅ v1   |
| Codex · Cursor · Gemini | —                                                                                                       | planned |

---

## CLI

```bash
npm i -g @uniqent/cli      # or use npx @uniqent/cli <command>
```

| Command                                | What it does                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `try <brain>`                          | One-command install of a featured brain (auto-detects your framework). `--list` to browse.          |
| `install <file\|url\|slug>`            | Install a brain into `--target <claude-code\|hermes\|openclaw>` (`--root <dir>`, `--cred ref=val`). |
| `inspect <file>`                       | Show a bundle's manifest, components, and permissions.                                              |
| `export --root <dir>`                  | Capture a running agent into a `.uniqent` (auto-detects the framework).                             |
| `import-vault <dir>`                   | Turn an Obsidian / second-brain vault into a signed brain.                                          |
| `pack <dir>` · `validate <dir\|file>`  | Build / check a brain from a source directory.                                                      |
| `search <q>` · `hub <mcp\|skills> <q>` | Find brains in a registry index; discover MCP servers + skills across hubs.                         |
| `keygen` · `sign <file>`               | Generate an Ed25519 keypair; sign a bundle.                                                         |

A few real flows:

```bash
# Install a brain into your framework, resolving your own credentials locally:
uniqent install my-brain.uniqent --target claude-code --root .

# Install straight from a raw URL (no registry needed):
uniqent install https://example.com/dev-powerpack.uniqent --target openclaw --root .

# Or by slug from any hosted index.json:
export UNIQENT_REGISTRY=https://raw.githubusercontent.com/RiggdAI/uniqent/main/registry/index.json
uniqent search coding && uniqent install dev-powerpack --target hermes --root . --cred github_pat=…
```

## Studio (visual builder)

```bash
pnpm --filter @uniqent/studio start   # local-first; open the URL it prints
```

## Build from source

Requires Node 22.13+ and pnpm (`corepack enable` provisions the pinned version).

```bash
pnpm install && pnpm build && pnpm test
```

---

## Docs

| Doc                                                                                         | What's in it                                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [`docs/SPEC.md`](docs/SPEC.md)                                                              | The `.uniqent` bundle-format reference (generated from the zod schema). |
| [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md)                                                  | Full engineering spec + milestone plan.                                 |
| [`docs/UX-REVIEW.md`](docs/UX-REVIEW.md)                                                    | CLI UX review + roadmap of gaps.                                        |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) · [`docs/GOVERNANCE.md`](docs/GOVERNANCE.md) | How to contribute + project governance.                                 |
| [`docs/SECURITY.md`](docs/SECURITY.md)                                                      | Security policy + disclosures.                                          |

<details>
<summary><strong>Status</strong> — pre-1.0, core loop works today</summary>

- **Spec · core · builder** — schema, bundle read/write + validation + secret-scan + Ed25519 signing,
  and a framework-agnostic engine to assemble a brain. ✅
- **Studio** — local-first React canvas to build a brain and export a signed `.uniqent`. ✅
- **Bring what you have** — `uniqent import-vault` + `uniqent export`. ✅
- **Install** — three adapters (Claude Code, Hermes, OpenClaw) + the CLI + Studio's Install button;
  the same signed `.uniqent` installs into all three. ✅
- **Distribute** — `@uniqent/cli` on npm; example brains in `examples/`; a file-based registry;
  memory-pack publishing. ✅
- **Next** — a hosted registry (accounts/web search) + a `uniqent://` web "Install" handoff;
  Codex/Cursor/Gemini adapters.

</details>

## License

- Code (CLI + adapters + core): **Apache-2.0** ([`LICENSE`](LICENSE))
- Spec text + schema: **CC0** ([`LICENSE-SPEC`](LICENSE-SPEC)) — any framework can implement an
  adapter without asking permission.

## Contributing & community

Contributions welcome — see [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) and
[`docs/GOVERNANCE.md`](docs/GOVERNANCE.md). Report security issues via
[`docs/SECURITY.md`](docs/SECURITY.md).
````

- [ ] **Step 3: Verify the README renders and the install command is high up**

Run: `grep -n "Try it in one command\|## What is Uniqent\|## CLI" README.md`
Expected: "Try it in one command" appears within the first ~30 lines (above "What is Uniqent?"),
confirming the install command is in the first screenful. Spot-check image paths exist:
`ls docs/img/try-demo.svg docs/img/studio-canvas.png docs/img/memory-brain.png`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/img/try-demo.svg
git commit -m "docs: restructure README action-first (try command + tables, Hermes-style clarity)"
```

---

## Task 8: Full-suite green + wrap-up

- [ ] **Step 1: Build everything**

Run: `pnpm build`
Expected: all packages build; `packages/cli/featured/research-analyst.uniqent` produced.

- [ ] **Step 2: Typecheck + lint + test**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green.

- [ ] **Step 3: Update CLAUDE.md status + CLI surface line**

In `CLAUDE.md`, add `try` to the documented CLI surface line and note the wow path:

- In the `CLI surface:` block, prepend `try <brain>` to the command list.
- Add a one-line note under Current status: "**Wow first-run** — `npx @uniqent/cli try <brain>` auto-detects the framework and one-command-installs a featured, signed, creds-free brain (research-analyst), ending with a suggested prompt."

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the wow first-run (uniqent try) in CLAUDE.md"
```

- [ ] **Step 5: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to open the PR / merge.

---

## Self-Review Notes

- **Spec coverage:** `suggestedPrompts` (Task 1) · `featuredBrains` (Task 2) · `detectTarget` real probe (Task 3) · enriched hero brain (Task 4) · baked signed featured bundles + loader (Task 5) · `try` command reusing a shared `runInstall` + payoff (Task 6) · README lead + demo asset (Task 7) · docs/full-suite (Task 8). All design sections map to a task.
- **Type consistency:** `detectTarget(DetectInput) → TargetGuess|null` used identically in Task 3 and Task 6; `loadFeaturedBundle(name) → Bundle` in Tasks 5 & 6; `runInstall(bundle, RunInstallOpts, io)` shared by `install` and `tryCmd`; `findFeatured`/`featuredBrains` from Task 2 used in Task 6.
- **Trust:** featured bundles are signed (Task 5) so `runInstall` prints "signature: valid ✓" without `--allow-unsigned`; verify is self-consistent against the embedded pubkey.
- **Idempotency:** `try` delegates to `adapter.apply`, which the conformance harness already asserts is idempotent.
