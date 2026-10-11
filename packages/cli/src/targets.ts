import { join } from 'node:path';

/** Environment variables that relocate a framework's native root. */
export interface RootEnv {
  HERMES_HOME?: string;
  OPENCLAW_STATE_DIR?: string;
}

/**
 * A target's native install root when --root is not given: the Claude Code project (`cwd`), the
 * Hermes home (`$HERMES_HOME`, else `~/.hermes`) or the OpenClaw state dir
 * (`$OPENCLAW_STATE_DIR`, else `~/.openclaw`).
 */
export function defaultRoot(target: string, env: RootEnv, home: string, cwd: string): string {
  if (target === 'claude-code') return cwd;
  if (target === 'hermes') return env.HERMES_HOME || join(home, '.hermes');
  if (target === 'openclaw') return env.OPENCLAW_STATE_DIR || join(home, '.openclaw');
  throw new Error(`no default root for unknown target "${target}"`);
}

export { nextStep } from '@uniqent/builder';
