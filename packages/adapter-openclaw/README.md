# @uniqent/adapter-openclaw

> Install a `.uniqent` agent brain into **OpenClaw**.

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it does

Translates a canonical `.uniqent` bundle into OpenClaw's native layout. The install root is the
OpenClaw **state dir** (`~/.openclaw`, or `$OPENCLAW_STATE_DIR`):

- MCP servers → `mcp.servers.<id>` in `openclaw.json`; Telegram/Discord channels → `channels.telegram` / `channels.discord`. The file is **merged**, never overwritten: every other key survives, and nothing outside OpenClaw's strict config schema is written.
- credentials → `${VAR}` references in `openclaw.json`; the values you supply at install go into the state-dir `.env` (merged, mode 0600) — secrets never travel in the bundle and are never inlined in the config.
- persona → `SOUL.md`, policies → `AGENTS.md`, profile → `USER.md`, memory facts → `MEMORY.md`, skills → `skills/`, all in the agent workspace (`agents.defaults.workspace`, else `<state dir>/workspace`). Uniqent owns only a `<!-- uniqent:begin -->…<!-- uniqent:end -->` section in each file and keeps your own content outside it.

Anything OpenClaw cannot represent (tasks/cron jobs, tools, runtime config, episodic memory, unmappable channels such as Slack/WhatsApp) is reported as a lossiness entry in the install plan — nothing is silently dropped.

Implements the [`@uniqent/adapter-sdk`](https://www.npmjs.com/package/@uniqent/adapter-sdk) `Adapter` interface.

## Install

```bash
npm install @uniqent/adapter-openclaw
```

Or install a brain directly via the Uniqent CLI without writing any code:

```bash
npx @uniqent/cli install my-brain.uniqent --target openclaw --root ~/.openclaw
```

## Usage (programmatic)

```ts
import { readBundle } from '@uniqent/core';
import { openClawAdapter } from '@uniqent/adapter-openclaw';

const root = `${process.env.HOME}/.openclaw`; // the OpenClaw state dir

// 1. Load the bundle
const bundle = await readBundle('my-brain.uniqent');

// 2. Plan — inspect what will be written and what credentials are required
const plan = await openClawAdapter.plan(bundle, { root });
console.log(
  'Files to write:',
  plan.writes.map((w) => w.path),
);
console.log('Credentials needed:', plan.requiresCredentials);
console.log('Lossiness:', plan.lossiness);

// 3. Apply — merge into openclaw.json + .env and write the workspace files
//    Pass resolved credential values keyed by their ref names
const resolved: Record<string, string> = { my_api_key: 'your-key' };
const result = await openClawAdapter.apply(bundle, plan, resolved, { root });
console.log('Written:', result.written);
console.log('Notes:', result.notes);
```

`plan()` is always safe to call — it reads the bundle and your current OpenClaw files but writes nothing. `apply()` fails before writing anything if a required credential is missing, and is idempotent: running it twice produces byte-identical files.

## Output layout

```
~/.openclaw/
  openclaw.json      # merged: mcp.servers.<id>, channels.<kind> (with ${VAR} refs)
  .env               # credential values, mode 0600 (merged)
  workspace/         # or agents.defaults.workspace
    SOUL.md          # persona (managed section)
    AGENTS.md        # policies (managed section)
    USER.md          # user profile (managed section)
    MEMORY.md        # memory facts (managed section)
    skills/          # one subdirectory per skill
```

If your `openclaw.json` uses JSON5-only syntax (comments, trailing commas), it is rewritten as
plain JSON and the plan reports that comments are not preserved.

## Exporting an existing OpenClaw setup

`openClawAdapter.export({ root })` captures an existing OpenClaw setup back into a canonical `Bundle` — `mcp.servers` and Telegram/Discord channels from `openclaw.json` (credentials become requirements; values are never captured), plus the workspace's `SOUL.md`/`IDENTITY.md`, `AGENTS.md`, `USER.md`, `MEMORY.md` and `skills/` — so you can re-pack and share it as a `.uniqent` file.

```ts
import { packBundle } from '@uniqent/core';
import { openClawAdapter } from '@uniqent/adapter-openclaw';

const bundle = await openClawAdapter.export({ root: `${process.env.HOME}/.openclaw` });
await packBundle(bundle, 'my-brain.uniqent');
```

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
