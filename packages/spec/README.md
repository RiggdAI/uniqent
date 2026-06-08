# @uniqent/spec

> The canonical `.uniqent` bundle schema — the source of truth for the format.

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it is

- The **zod schemas** that define every file inside a `.uniqent` bundle:
  - `Manifest` — `uniqent.json`, the root descriptor (name, version, author, components, compatibility)
  - `CredentialRequirement` — what secrets the bundle needs (never the values themselves)
  - `PermissionScope` — the permission sheet shown to the user before any install write
  - `McpServer` / `McpServersFile` — MCP server declarations (`streamable-http`, `sse`, `stdio`)
  - `MemoryItem` / `MemoryProfile` — facts, decisions, preferences, milestones, episodic entries
  - `Channel` / `ChannelsFile` — messaging surfaces (Telegram, Discord, Slack, …)
  - `ToolDecl` / `ToolsFile` — native/built-in tool enablement
  - `Task` / `TaskTrigger` — scheduled and event-driven automations
  - `RuntimeConfig` — model/provider preferences, autonomy level, tool allowlist
  - `Signature` — detached Ed25519 signature over a canonical SHA-256 digest
- A generated **JSON Schema** (Draft-07) shipped in `schema/uniqent.schema.json` for non-TypeScript consumers.
- Common primitives: `Slug`, `Semver`, `Autonomy`, `SPEC_VERSION`.
- A `buildJsonSchema()` helper and `SCHEMA_REGISTRY` for codegen and drift detection.
- The format is versioned (`specVersion: "0.1"`); the spec text/schema is **CC0** so anyone can build on it.

## Install

```bash
npm install @uniqent/spec
```

## Usage

```ts
import { Manifest } from '@uniqent/spec';

// Parse and validate a manifest object (throws on invalid input)
const manifest = Manifest.parse({
  specVersion: '0.1',
  name: 'my-agent',
  displayName: 'My Agent',
  version: '1.0.0',
  description: 'A portable AI agent brain.',
  author: { name: 'Alice' },
  license: 'MIT',
  tags: ['assistant'],
  components: {
    identity: true,
    memory: { facts: 12, episodic: 3, hasProfile: true },
    skills: ['web-search'],
    mcp: ['github'],
    tools: [],
    tasks: [],
    channels: [],
  },
  credentials: [],
  permissions: {
    filesystem: { read: [], write: [] },
    network: { endpoints: ['api.github.com'] },
    autonomy: 'suggest',
    spawnsProcesses: false,
  },
  compatibility: { targets: ['claude-code', 'hermes'] },
});

// Or use safeParse for non-throwing validation
const result = Manifest.safeParse(unknownData);
if (!result.success) {
  console.error(result.error.issues);
}
```

### JSON Schema (non-TypeScript consumers)

```js
import schema from '@uniqent/spec/schema';
// schema is the full Draft-07 JSON Schema document
```

Or reference the published file directly:
`node_modules/@uniqent/spec/schema/uniqent.schema.json`

## Where this fits

`@uniqent/spec` is consumed by [`@uniqent/core`](https://www.npmjs.com/package/@uniqent/core) (bundle read/write, signing, secret-scan), [`@uniqent/builder`](https://www.npmjs.com/package/@uniqent/builder) (brain assembly engine), and every adapter (`@uniqent/adapter-claude-code`, `@uniqent/adapter-hermes`, `@uniqent/adapter-openclaw`). The full human-readable reference is `docs/SPEC.md` in the [monorepo](https://github.com/RiggdAI/uniqent).

## License

CC0-1.0 for the spec text/schema. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
