# @uniqent/builder

> Framework-agnostic engine to assemble an AI-agent "brain" into a validated `.uniqent` bundle.

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it does

- **Assemble a brain** — build a `Brain` model (persona, MCP stack, skills, memory, channels, config) via a fluent API, then call `.validate()` or `.toBundle()` to emit a validated `Bundle`.
- **Built-in catalogs** — `MCP_CATALOG`, `SKILL_CATALOG`, and `CHANNEL_CATALOG` for curated servers and channels; `addMcpFromCatalog` / `addSkillFromCatalog` / `addChannelFromCatalog` on `Brain` for one-call wiring.
- **Hub discovery** — `searchMcpHubs` / `searchSkillHubs` fan out across the MCP Registry, Smithery, GitHub, and any JSON-index hub, with per-source error isolation; `defaultMcpSources` / `defaultSkillSources` assemble the standard source list.
- **Memory tooling** — `parseMemoryMarkdown` splits markdown into structured `ImportedMemoryItem`s, extracting Obsidian-style `[[entities]]` and `#tags`; `memoryGraph` builds a force-directed knowledge graph; `importVault` ingests an entire second-brain vault folder (SOUL.md → persona, USER.md → profile, notes → memory).
- **Featured brains & framework detection** — `featuredBrains()` / `findFeatured(name)` expose the curated example catalog; `detectTarget({ cwd, home })` probes the machine for a known agent framework (Claude Code, OpenClaw, Hermes).

This is the shared core that both **Uniqent Studio** and **[@uniqent/cli](https://www.npmjs.com/package/@uniqent/cli)** are built on.

## Install

```bash
npm install @uniqent/builder
```

## Usage

### Assemble a brain and validate it

```typescript
import { Brain } from '@uniqent/builder';

const brain = Brain.create({
  name: 'research-analyst',
  displayName: 'Research Analyst',
  version: '1.0.0',
  description: 'Fetches primary sources and writes fully-cited summaries.',
  author: { name: 'Acme Corp' },
  license: 'MIT',
  tags: ['research', 'citations'],
});

brain.setPersona('You are a meticulous research analyst...');
brain.addMcpFromCatalog('github'); // wires server + credential in one call
brain.addMemory({ kind: 'fact', text: 'Always cite the primary source URL.' });

const result = brain.validate();
if (!result.ok) {
  console.error(result.errors);
} else {
  const bundle = brain.toBundle(); // ready to pack / sign / install
}
```

### Detect the local agent framework

```typescript
import { detectTarget } from '@uniqent/builder';
import os from 'node:os';

const guess = await detectTarget({ cwd: process.cwd(), home: os.homedir() });
// guess?.id === 'claude-code' | 'openclaw' | 'hermes' | null
```

### Browse hub discovery

```typescript
import { searchMcpHubs, defaultMcpSources } from '@uniqent/builder';

const { results, errors } = await searchMcpHubs('github', defaultMcpSources());
for (const r of results) {
  console.log(r.entry.name, r.popularity);
}
```

### Import a second-brain vault

```typescript
import { importVault } from '@uniqent/builder';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function readVault(root: string) {
  // collect { path, content } for every .md file under root (your walk here)
  const files = [
    { path: 'SOUL.md', content: '...' },
    { path: 'notes/ideas.md', content: '...' },
  ];
  return importVault(files);
}

const vault = await readVault('./my-obsidian-vault');
// vault.persona, vault.profile, vault.items (memory), vault.stats
```

### Featured brains

```typescript
import { featuredBrains, findFeatured } from '@uniqent/builder';

console.log(featuredBrains()); // [{ name, displayName, pitch, suggestedPrompts }]
console.log(findFeatured('research-analyst'));
```

## API surface

| Export                | Kind                    | Description                                                                                                                                                                                      |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Brain`               | class                   | Mutable brain model — `Brain.create(meta)`, `Brain.fromBundle(bundle)`, `.setPersona`, `.addMemory`, `.addMcpServer`, `.addSkill`, `.addChannel`, `.addCredential`, `.toBundle()`, `.validate()` |
| `BrainMeta`           | interface               | Metadata passed to `Brain.create`                                                                                                                                                                |
| `deriveComponents`    | function                | Derive the manifest `components` block from brain contents                                                                                                                                       |
| `derivePermissions`   | function                | Derive a `PermissionScope` from MCP servers, channels, and runtime config                                                                                                                        |
| `MCP_CATALOG`         | `McpCatalogEntry[]`     | Curated MCP servers                                                                                                                                                                              |
| `SKILL_CATALOG`       | `SkillCatalogEntry[]`   | Curated skills (user-extensible)                                                                                                                                                                 |
| `CHANNEL_CATALOG`     | `ChannelCatalogEntry[]` | Curated channels                                                                                                                                                                                 |
| `searchMcpHubs`       | async function          | Fan-out MCP search across `CatalogSource[]`                                                                                                                                                      |
| `searchSkillHubs`     | async function          | Fan-out skill search across `CatalogSource[]`                                                                                                                                                    |
| `defaultMcpSources`   | function                | Standard MCP hub sources (MCP Registry + Smithery + JSON indexes)                                                                                                                                |
| `defaultSkillSources` | function                | Standard skill hub sources (GitHub + JSON indexes)                                                                                                                                               |
| `installMcpHubResult` | function                | Add a hub result (server + all credentials) to a `Brain`                                                                                                                                         |
| `parseMemoryMarkdown` | function                | Split markdown into `ImportedMemoryItem[]` with `[[entities]]` / `#tags`                                                                                                                         |
| `parseMemoryText`     | function                | Extract entities and tags from one memory string                                                                                                                                                 |
| `stripMemoryMarkup`   | function                | Render memory text for plain-text output (strips wiki-links and tags)                                                                                                                            |
| `memoryGraph`         | function                | Build a `MemoryGraph` (nodes + edges) for force-directed visualization                                                                                                                           |
| `importVault`         | function                | Ingest a vault of `VaultFile[]` → `VaultImport` (persona / profile / memory)                                                                                                                     |
| `parseProfile`        | function                | Parse a USER.md into a flat `Record<string, string>` profile                                                                                                                                     |
| `featuredBrains`      | function                | Return the curated `FeaturedBrain[]` list                                                                                                                                                        |
| `findFeatured`        | function                | Look up a `FeaturedBrain` by slug                                                                                                                                                                |
| `detectTarget`        | async function          | Probe the machine for a known framework; returns `TargetGuess \| null`                                                                                                                           |

## Where this fits

Builds on [`@uniqent/spec`](https://www.npmjs.com/package/@uniqent/spec) (the canonical `.uniqent` schema) and [`@uniqent/core`](https://www.npmjs.com/package/@uniqent/core) (bundle read/write, validation, signing).

Front-ended by [`@uniqent/cli`](https://www.npmjs.com/package/@uniqent/cli) and Uniqent Studio — both are thin layers over this package. Adapters (`@uniqent/adapter-claude-code`, `@uniqent/adapter-hermes`, `@uniqent/adapter-openclaw`) consume the `Bundle` produced by `brain.toBundle()`.

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
