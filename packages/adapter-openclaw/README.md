# @uniqent/adapter-openclaw

> Install a `.uniqent` agent brain into **OpenClaw**.

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it does

Translates a canonical `.uniqent` bundle into OpenClaw's native, file-based layout:

- persona → `SOUL.md`
- memory + profile → `MEMORY.md`
- skills → `skills/`
- MCP + channels + tasks → `openclaw.json` (your own credentials resolved locally at install — secrets never travel in the bundle)

Any bundle components that OpenClaw cannot represent natively (e.g. `tools`) are reported as lossiness entries in the install plan — nothing is silently dropped.

Implements the [`@uniqent/adapter-sdk`](https://www.npmjs.com/package/@uniqent/adapter-sdk) `Adapter` interface.

## Install

```bash
npm install @uniqent/adapter-openclaw
```

Or install a brain directly via the Uniqent CLI without writing any code:

```bash
npx @uniqent/cli install my-brain.uniqent --target openclaw --root .
```

## Usage (programmatic)

```ts
import { readBundle } from '@uniqent/core';
import { openClawAdapter } from '@uniqent/adapter-openclaw';

const root = '/path/to/openclaw-project';

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

// 3. Apply — write files into the OpenClaw project root
//    Pass resolved credential values keyed by their ref names
const resolved: Record<string, string> = {
  my_api_key: process.env.MY_API_KEY ?? '',
};
const result = await openClawAdapter.apply(bundle, plan, resolved, { root });
console.log('Written:', result.written);
console.log('Notes:', result.notes);
```

`plan()` is always safe to call — it reads the bundle but writes nothing. `apply()` is idempotent: running it twice produces the same file tree.

## Output layout

After `apply()`, your OpenClaw project root will contain:

```
SOUL.md          # agent identity + policies
MEMORY.md        # semantic memory facts + user profile
skills/          # one subdirectory per skill
openclaw.json    # MCP servers, channels, and tasks (credentials inlined)
```

## Exporting an existing OpenClaw setup

`openClawAdapter.export({ root })` captures an existing OpenClaw project back into a canonical `Bundle` (reading `SOUL.md` and `skills/`), so you can re-pack and share it as a `.uniqent` file.

```ts
import { packBundle } from '@uniqent/core';
import { openClawAdapter } from '@uniqent/adapter-openclaw';

const bundle = await openClawAdapter.export({ root: '/path/to/openclaw-project' });
await packBundle(bundle, 'my-brain.uniqent');
```

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
