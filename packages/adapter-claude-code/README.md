# @uniqent/adapter-claude-code

> Install a `.uniqent` agent brain into **Claude Code**.

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it does

Translates a canonical `.uniqent` bundle into Claude Code's native layout:

- **skills** → `.claude/skills/`
- **persona + policies + memory** → `AGENTS.md`
- **MCP servers** → merged `.mcp.json` (your credentials are resolved locally — secrets never travel in the bundle)
- **channels / tasks / tools** that Claude Code can't hold are reported as **lossiness**, never silently dropped

Implements the [`@uniqent/adapter-sdk`](https://www.npmjs.com/package/@uniqent/adapter-sdk) `Adapter` interface (`detect` / `plan` / `apply` / `export`).

## Install

```bash
npm install @uniqent/adapter-claude-code
```

Most people don't need this directly. Use the CLI instead:

```bash
npx @uniqent/cli install my-brain.uniqent --target claude-code --root .
```

## Usage (programmatic)

```typescript
import { claudeCodeAdapter } from '@uniqent/adapter-claude-code';
import { readBundle } from '@uniqent/core';
import type { ResolvedCredentials } from '@uniqent/adapter-sdk';

// Load a signed .uniqent bundle
const bundle = await readBundle('./my-brain.uniqent');

// 1. Plan — inspect what will be written and what credentials are needed
const plan = await claudeCodeAdapter.plan(bundle);
console.log('Writes:', plan.writes);
console.log('Needs credentials:', plan.requiresCredentials);
console.log('Lossiness:', plan.lossiness);

// 2. Resolve credentials locally (never stored in the bundle)
const resolved: ResolvedCredentials = {
  'github-mcp_token': process.env.GITHUB_TOKEN ?? '',
};

// 3. Apply — write the native Claude Code layout into the target directory
const result = await claudeCodeAdapter.apply(bundle, plan, resolved, { root: '/path/to/project' });
console.log('Written:', result.written);
console.log('Notes:', result.notes);
```

### Export (capture an existing Claude Code setup)

```typescript
import { claudeCodeAdapter } from '@uniqent/adapter-claude-code';
import { packBundle } from '@uniqent/core';

// Reverse-translate a Claude Code project back into a portable .uniqent bundle.
// Credential values are scrubbed — only the requirement refs are captured.
const bundle = await claudeCodeAdapter.export({ root: '/path/to/project' });
await packBundle(bundle, './captured-brain.uniqent');
```

## What gets written

| Bundle component            | Claude Code target       | Notes                                                    |
| --------------------------- | ------------------------ | -------------------------------------------------------- |
| Skills                      | `.claude/skills/<name>/` | One directory per skill                                  |
| Persona + policies + memory | `AGENTS.md`              | Memory folded in as flat text                            |
| MCP servers                 | `.mcp.json`              | Merged with any existing servers; creds injected locally |
| Channels                    | —                        | Reported as lossiness (`dropped`)                        |
| Tasks / automations         | —                        | Reported as lossiness (`dropped`)                        |
| Native tools                | —                        | Reported as lossiness (`dropped`)                        |

`apply` is idempotent — running it twice produces the same result.

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
