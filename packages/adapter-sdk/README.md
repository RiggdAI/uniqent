# @uniqent/adapter-sdk

> The Uniqent `Adapter` interface + a conformance harness — write a framework adapter for `.uniqent` brains.

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it is

- The **`Adapter` interface**: `detect`, `plan`, `apply`, `export` — the four operations every framework adapter must implement. Install is a **translation, not a copy** — one canonical bundle → the target framework's native layout.
- A **conformance harness** (`runConformance`) that runs `plan → apply → apply` into a sandbox and asserts: no secret values written to disk, lossiness fully reported (no silent loss), and `apply` idempotent on a second run.

Implement this interface to add support for a new agent framework. See the reference adapters: [claude-code](https://www.npmjs.com/package/@uniqent/adapter-claude-code), [hermes](https://www.npmjs.com/package/@uniqent/adapter-hermes), [openclaw](https://www.npmjs.com/package/@uniqent/adapter-openclaw).

## Install

```bash
npm install @uniqent/adapter-sdk
```

## Usage

### The `Adapter` interface

```ts
import type {
  Adapter,
  DetectResult,
  InstallPlan,
  InstallResult,
  InstallOptions,
  ExportOptions,
  ResolvedCredentials,
} from '@uniqent/adapter-sdk';
import type { Bundle } from '@uniqent/core';

const myAdapter: Adapter = {
  id: 'my-framework',
  displayName: 'My Framework',

  // Probe whether the framework is present at an optional root directory.
  async detect({ root }: { root?: string }): Promise<DetectResult> {
    return { present: false };
  },

  // Analyse a bundle and return a dry-run plan: what will be written, which
  // MCP servers / channels need registering, what credentials are required,
  // and what (if anything) will be lost or transformed.
  async plan(bundle: Bundle, opts: InstallOptions): Promise<InstallPlan> {
    return {
      writes: [],
      mcpRegistrations: [],
      channelRegistrations: [],
      lossiness: [],
      requiresCredentials: [],
    };
  },

  // Write the bundle into the framework's native layout using the plan
  // produced above and already-resolved credential values.
  async apply(
    bundle: Bundle,
    plan: InstallPlan,
    resolved: ResolvedCredentials,
    opts: InstallOptions,
  ): Promise<InstallResult> {
    return { written: [], notes: [] };
  },

  // Capture an existing framework installation back into a canonical Bundle,
  // scrubbing real secret values (only credential refs travel in bundles).
  async export(opts: ExportOptions): Promise<Bundle> {
    throw new Error('not implemented');
  },
};
```

### Running the conformance harness

```ts
import { runConformance } from '@uniqent/adapter-sdk';
import { myAdapter } from './my-adapter.js';
import { loadBundle } from '@uniqent/core';

const bundle = await loadBundle('./test/fixtures/sample.uniqent');
const result = await runConformance(myAdapter, bundle, '/tmp/sandbox');

for (const check of result.checks) {
  console.log(check.pass ? '✓' : '✗', check.name, check.detail ?? '');
}

if (!result.ok) process.exit(1);
```

The harness runs three assertions:

| Check                              | What it verifies                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apply is idempotent`              | Calling `apply` twice produces identical files on disk.                                                                  |
| `no secret values written to disk` | No known secret patterns (`sk-…`, `ghp_…`, `xoxb-…`, AWS keys, PEM private keys) appear in any written file.             |
| `no silent loss of components`     | Every bundle component that the framework cannot represent is declared in `plan.lossiness`; nothing is silently dropped. |

### Key types

| Type                  | Purpose                                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------- | --------- | --------------- |
| `DetectResult`        | Returned by `detect` — whether the framework is present, its version, and the config root.                |
| `InstallOptions`      | `{ root: string }` — the framework project root passed to `plan` and `apply`.                             |
| `ExportOptions`       | `{ root: string }` — the framework project root passed to `export`.                                       |
| `InstallPlan`         | Dry-run output: `writes`, `mcpRegistrations`, `channelRegistrations`, `lossiness`, `requiresCredentials`. |
| `Lossiness`           | A single loss record: `{ component, issue, action }` where `action` is `'truncated'                       | 'dropped' | 'transformed'`. |
| `ResolvedCredentials` | `Record<string, string>` — credential ref → real value map, resolved locally before `apply`.              |
| `InstallResult`       | `{ written: string[], notes: string[] }` — paths written and any human-readable notes.                    |
| `ConformanceResult`   | `{ ok: boolean, checks: ConformanceCheck[] }` — returned by `runConformance`.                             |

## Where this fits

Implements against [`@uniqent/spec`](https://www.npmjs.com/package/@uniqent/spec) bundles via [`@uniqent/core`](https://www.npmjs.com/package/@uniqent/core). Consumed by [`@uniqent/cli`](https://www.npmjs.com/package/@uniqent/cli) and Uniqent Studio.

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
