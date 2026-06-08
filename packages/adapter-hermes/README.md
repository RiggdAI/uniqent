# @uniqent/adapter-hermes

> Install a `.uniqent` agent brain into **Hermes** (with bounded-memory prioritization).

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it does

Translates a canonical `.uniqent` bundle into Hermes's native layout:

| Bundle component               | Hermes output            | Notes                                                                            |
| ------------------------------ | ------------------------ | -------------------------------------------------------------------------------- |
| persona                        | `SOUL.md`                | Policies appended under `## Policies`                                            |
| memory facts                   | `MEMORY.md`              | Bounded to ~2200 chars; sorted by `importance` (desc), surplus facts **dropped** |
| user profile                   | `USER.md`                | Bounded to ~1375 chars; truncated at the field boundary                          |
| skills                         | `skills/<name>/SKILL.md` | Copied verbatim                                                                  |
| MCP servers + channels + tasks | `hermes.json`            | Credential values stored only in `.env`; config holds `${ENV_VAR}` refs          |
| resolved credentials           | `.env`                   | Written at apply time; never travels in the bundle                               |

**Lossy is acceptable — silent loss is not.** Any facts or profile fields that do not fit are reported as `lossiness` entries in the `InstallPlan` so you can see exactly what was trimmed before committing the install.

Implements the [`@uniqent/adapter-sdk`](https://www.npmjs.com/package/@uniqent/adapter-sdk) `Adapter` interface.

## Install

```bash
npm install @uniqent/adapter-hermes
```

Or install a brain directly via the CLI:

```bash
npx @uniqent/cli install my-brain.uniqent --target hermes --root .
```

## Usage (programmatic)

```ts
import { readBundle } from '@uniqent/core';
import { hermesAdapter } from '@uniqent/adapter-hermes';

// 1. Load the bundle
const bundle = await readBundle('./my-brain.uniqent');

// 2. Plan the install — inspect lossiness before writing anything
const plan = await hermesAdapter.plan(bundle, { root: '/path/to/hermes-project' });

if (plan.lossiness.length > 0) {
  for (const loss of plan.lossiness) {
    console.warn(`[${loss.action}] ${loss.component}: ${loss.issue}`);
    // e.g. [truncated] memory: 12 of 30 facts dropped to fit MEMORY.md (~2200 chars);
    //      consider an external memory provider.
  }
}

// 3. Resolve any required credentials
const resolved: Record<string, string> = {
  github_pat: process.env.GITHUB_PAT ?? '',
};

// 4. Apply — writes SOUL.md, MEMORY.md, USER.md, skills/, hermes.json, .env
const result = await hermesAdapter.apply(bundle, plan, resolved, {
  root: '/path/to/hermes-project',
});

console.log('Written:', result.written);
// e.g. ['SOUL.md', 'MEMORY.md', 'USER.md', 'skills/code-review/SKILL.md', 'hermes.json', '.env']
```

`apply()` is idempotent — running it twice produces the same output.

## Memory bounds

Hermes enforces hard file-size limits on its context files. This adapter respects them:

- **`MEMORY.md`** — capped at **2200 characters**. Facts are sorted by their `importance` field (highest first); lower-importance facts are dropped if they would exceed the cap. The count of dropped facts appears in `plan.lossiness`.
- **`USER.md`** — capped at **1375 characters**. Profile fields are written in declaration order; any fields that would push the file over the cap are omitted and reported as lossiness.

If your brain carries more memory than Hermes can hold, consider splitting it into topic-scoped bundles or pointing Hermes at an external memory provider.

## Exporting an existing Hermes setup

```ts
const bundle = await hermesAdapter.export({ root: '/path/to/hermes-project' });
// Returns a canonical Bundle: persona from SOUL.md, facts from MEMORY.md bullet lines,
// skills from skills/<name>/SKILL.md. Pack and sign with @uniqent/core.
```

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
