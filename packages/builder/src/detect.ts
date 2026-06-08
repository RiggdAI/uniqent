import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export type TargetId = 'claude-code' | 'openclaw' | 'hermes';

export interface TargetGuess {
  id: TargetId;
  /** The framework project root to install into. */
  configRoot: string;
}

export interface DetectInput {
  cwd: string;
  home: string;
  env?: Record<string, string | undefined>;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe the machine for a known agent framework. Priority claude-code → openclaw → hermes.
 * Returns null if none is found (caller defaults to claude-code in cwd and says so).
 */
export async function detectTarget(input: DetectInput): Promise<TargetGuess | null> {
  const env = input.env ?? {};

  // Claude Code: a .claude dir in the project or in $HOME. Install root is always cwd.
  if ((await exists(join(input.cwd, '.claude'))) || (await exists(join(input.home, '.claude')))) {
    return { id: 'claude-code', configRoot: input.cwd };
  }

  // OpenClaw: explicit state dir, or an openclaw.json in cwd.
  if (env.OPENCLAW_STATE_DIR) return { id: 'openclaw', configRoot: env.OPENCLAW_STATE_DIR };
  if (await exists(join(input.cwd, 'openclaw.json')))
    return { id: 'openclaw', configRoot: input.cwd };

  // Hermes: a hermes.json in cwd, or ~/.hermes.
  if (await exists(join(input.cwd, 'hermes.json'))) return { id: 'hermes', configRoot: input.cwd };
  if (await exists(join(input.home, '.hermes'))) return { id: 'hermes', configRoot: input.home };

  return null;
}
