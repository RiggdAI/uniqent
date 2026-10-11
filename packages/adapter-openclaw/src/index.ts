import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { nodeAdapter, type Adapter, type DetectResult } from '@uniqent/adapter-sdk';
import { isNotFound } from './fs.js';
import { openClawPure } from './pure.js';
import { CONFIG_FILE } from './translate.js';

export * from './pure.js';

async function detect({ root }: { root?: string }): Promise<DetectResult> {
  const configRoot = root ?? process.env.OPENCLAW_STATE_DIR ?? join(homedir(), '.openclaw');
  try {
    await stat(join(configRoot, CONFIG_FILE));
    return { present: true, configRoot };
  } catch (err) {
    if (isNotFound(err)) return { present: false, configRoot };
    throw err;
  }
}

/**
 * OpenClaw adapter. `root` is the OpenClaw STATE DIR (`~/.openclaw`, or `$OPENCLAW_STATE_DIR`):
 * - `<root>/openclaw.json` — merged (never overwritten): `mcp.servers.<id>` and mappable
 *   `channels.<kind>` only, with `${VAR}` credential references (see ./config.ts)
 * - `<root>/.env` — the credential values, merged, mode 0600 (see ./env.ts)
 * - the agent workspace (`agents.defaults.workspace`, else `<root>/workspace`): managed sections
 *   in SOUL.md / AGENTS.md / USER.md / MEMORY.md, plus `skills/` (see ./workspace.ts)
 */
export const openClawAdapter: Adapter = nodeAdapter(openClawPure, detect);
