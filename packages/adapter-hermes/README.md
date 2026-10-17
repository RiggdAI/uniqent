# @uniqent/adapter-hermes

> Install a `.uniqent` agent brain into **Hermes** (with bounded-memory prioritization).

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it does

Translates a canonical `.uniqent` bundle into a Hermes Agent home. `root` is **`$HERMES_HOME`**
(normally `~/.hermes`); existing files are merged, never wiped.

| Bundle component                | Hermes output                                 | Notes                                                                                                 |
| ------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| persona (+ policies)            | `SOUL.md`                                     | Policies appended under `## Policies`                                                                 |
| memory facts                    | `memories/MEMORY.md`                          | `§`-delimited entries, prioritized by `importance`, bounded; existing entries kept and deduped        |
| user profile                    | `memories/USER.md`                            | One `key: value` entry per field, bounded; existing entries kept and deduped                          |
| skills                          | `skills/<name>/…`                             | Copied verbatim; paths are confined to `skills/`                                                      |
| MCP servers                     | `config.yaml` → `mcp_servers.<id>`            | Merged with the `yaml` Document API (other keys + comments survive); secrets only as `${ENV}` refs    |
| channels                        | `.env` → `TELEGRAM_/DISCORD_/SLACK_BOT_TOKEN` | The vars Hermes' gateway reads; other kinds (WhatsApp, SMS, email, webhook) are reported as lossiness |
| resolved credentials            | `.env`                                        | Merged (existing lines kept, only our keys set), mode `0600`; never travels in the bundle             |
| tasks                           | —                                             | Reported as lossiness: Hermes' `cron/jobs.json` is live scheduler state; use `hermes cron create`     |
| episodic memory, tools, runtime | —                                             | Reported as lossiness                                                                                 |

**Lossy is acceptable — silent loss is not.** Anything that does not fit or has no Hermes equivalent is reported in the `InstallPlan`'s `lossiness` (naming each skipped memory entry) before anything is written.

Implements the [`@uniqent/adapter-sdk`](https://www.npmjs.com/package/@uniqent/adapter-sdk) `Adapter` interface.

## Install

```bash
npm install @uniqent/adapter-hermes
```

Or install a brain directly via the CLI:

```bash
npx @uniqent/cli install my-brain.uniqent --target hermes --root ~/.hermes
```

## Usage (programmatic)

```ts
import { readBundle } from '@uniqent/core';
import { hermesAdapter } from '@uniqent/adapter-hermes';

// 1. Load the bundle
const bundle = await readBundle('./my-brain.uniqent');

// 2. Plan the install — inspect lossiness before writing anything
const plan = await hermesAdapter.plan(bundle, { root: `${process.env.HOME}/.hermes` });

if (plan.lossiness.length > 0) {
  for (const loss of plan.lossiness) {
    console.warn(`[${loss.action}] ${loss.component}: ${loss.issue}`);
    // e.g. [truncated] memory: 12 of 30 not written to memories/MEMORY.md (2200-char budget …): d3 (…); …
  }
}

// 3. Resolve any required credentials
const resolved: Record<string, string> = {
  github_pat: process.env.GITHUB_PAT ?? '',
};

// 4. Apply — writes SOUL.md, memories/, skills/, and merges config.yaml + .env
const result = await hermesAdapter.apply(bundle, plan, resolved, {
  root: `${process.env.HOME}/.hermes`,
});

console.log('Written:', result.written);
// e.g. ['SOUL.md', 'memories/MEMORY.md', 'memories/USER.md', 'skills/code-review/SKILL.md', 'config.yaml', '.env']
```

`apply()` is idempotent — running it twice produces byte-identical files.

## Memory bounds

Hermes stores memory as entries joined by `\n§\n` and budgets the whole joined file
(`memory.memory_char_limit` / `memory.user_char_limit` in `config.yaml`, default **2200** / **1375** chars):

- **`memories/MEMORY.md`** — facts sorted by `importance` (highest first). A fact that would exceed the budget is skipped and the next one is still tried.
- **`memories/USER.md`** — profile fields in declaration order, same rule.
- Entries already in either file are kept and count against the budget; entries equal to ours are not duplicated.

Every skipped entry is named in `plan.lossiness`. If your brain carries more memory than Hermes can hold, consider an external memory provider.

## Exporting an existing Hermes setup

```ts
const bundle = await hermesAdapter.export({ root: `${process.env.HOME}/.hermes` });
// Returns a canonical Bundle: persona from SOUL.md, facts/profile from memories/ (split on §),
// skills from skills/**/SKILL.md, and MCP servers from config.yaml mcp_servers — with credential
// REQUIREMENTS recovered from ${VAR} refs, never their values. Pack and sign with @uniqent/core.
```

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
