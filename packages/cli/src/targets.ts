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

/** What to do after a successful install into `root` (the brain is picked up on (re)start). */
export function nextStep(target: string, root: string): string {
  if (target === 'claude-code')
    return `Open ${root} in Claude Code (run \`claude\` there) to use the brain.`;
  if (target === 'hermes')
    return `Start Hermes (\`hermes\`; use HERMES_HOME=${root} if that is not your default ~/.hermes). If lossiness lists dropped tasks, schedule them with the \`hermes cron create …\` commands shown there.`;
  if (target === 'openclaw')
    return `Restart the OpenClaw gateway so it loads the brain (use OPENCLAW_STATE_DIR=${root} if that is not your default ~/.openclaw).`;
  throw new Error(`no next-step text for unknown target "${target}"`);
}
