import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nodeAdapter, type Adapter, type DetectResult } from '@uniqent/adapter-sdk';
import { claudeCodePure } from './pure.js';
import { MCP_JSON } from './translate.js';

export * from './pure.js';

async function detect({ root }: { root?: string }): Promise<DetectResult> {
  const r = root ?? process.cwd();
  const present = existsSync(join(r, '.claude')) || existsSync(join(r, MCP_JSON));
  return { present, configRoot: join(r, '.claude') };
}

/** Installs into a Claude Code project: `root` is the project directory. */
export const claudeCodeAdapter: Adapter = nodeAdapter(claudeCodePure, detect);
