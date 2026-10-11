export type TargetId = 'claude-code' | 'openclaw' | 'hermes';

export interface TargetGuess {
  id: TargetId;
  /** The framework project root to install into. */
  configRoot: string;
}

/** Names whose presence in a folder marks a framework project (detectProject's rules). */
export const PROJECT_MARKERS = [
  '.claude',
  '.mcp.json',
  'openclaw.json',
  'config.yaml',
  'SOUL.md',
] as const;

export type ProjectMarker = (typeof PROJECT_MARKERS)[number];

/** Frameworks whose markers are `present` in `dir`; each installs into `dir`. */
export function projectTargets(dir: string, present: ReadonlySet<ProjectMarker>): TargetGuess[] {
  const found: TargetGuess[] = [];
  if (present.has('.claude') || present.has('.mcp.json'))
    found.push({ id: 'claude-code', configRoot: dir });
  if (present.has('openclaw.json')) found.push({ id: 'openclaw', configRoot: dir });
  // Hermes: a native HERMES_HOME layout (config.yaml + SOUL.md).
  if (present.has('config.yaml') && present.has('SOUL.md'))
    found.push({ id: 'hermes', configRoot: dir });
  return found;
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
