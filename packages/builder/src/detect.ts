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
  env: Record<string, string | undefined>;
}

/** Several frameworks were found at the same level, so no target can be picked safely. */
export class AmbiguousTargetError extends Error {
  readonly candidates: TargetGuess[];
  constructor(where: string, candidates: TargetGuess[]) {
    super(
      `several agent frameworks detected in ${where}: ${candidates
        .map((c) => `${c.id} (${c.configRoot})`)
        .join(', ')}; pass --target <${candidates.map((c) => c.id).join('|')}> to choose one`,
    );
    this.name = 'AmbiguousTargetError';
    this.candidates = candidates;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Frameworks whose project-level markers sit in `cwd`; each installs into `cwd`. */
async function detectProject(cwd: string): Promise<TargetGuess[]> {
  const found: TargetGuess[] = [];
  if ((await exists(join(cwd, '.claude'))) || (await exists(join(cwd, '.mcp.json'))))
    found.push({ id: 'claude-code', configRoot: cwd });
  if (await exists(join(cwd, 'openclaw.json'))) found.push({ id: 'openclaw', configRoot: cwd });
  // Hermes: a native HERMES_HOME layout (config.yaml + SOUL.md).
  if ((await exists(join(cwd, 'config.yaml'))) && (await exists(join(cwd, 'SOUL.md'))))
    found.push({ id: 'hermes', configRoot: cwd });
  return found;
}

/** Frameworks installed for the user (in $HOME or via their state-dir env vars). */
async function detectHome(input: DetectInput): Promise<TargetGuess[]> {
  const found: TargetGuess[] = [];
  // Claude Code keeps user config in ~/.claude, but a brain installs into the project (cwd).
  if (await exists(join(input.home, '.claude')))
    found.push({ id: 'claude-code', configRoot: input.cwd });
  // OpenClaw: an explicit state dir, else ~/.openclaw holding openclaw.json.
  const openclawDir = input.env.OPENCLAW_STATE_DIR;
  if (openclawDir) found.push({ id: 'openclaw', configRoot: openclawDir });
  else if (await exists(join(input.home, '.openclaw', 'openclaw.json')))
    found.push({ id: 'openclaw', configRoot: join(input.home, '.openclaw') });
  // Hermes: an explicit HERMES_HOME, else the ~/.hermes dir.
  const hermesDir = input.env.HERMES_HOME;
  if (hermesDir) found.push({ id: 'hermes', configRoot: hermesDir });
  else if (await exists(join(input.home, '.hermes')))
    found.push({ id: 'hermes', configRoot: join(input.home, '.hermes') });
  return found;
}

function pickOne(where: string, found: TargetGuess[]): TargetGuess | null {
  if (found.length > 1) throw new AmbiguousTargetError(where, found);
  return found[0] ?? null;
}

/**
 * Probe the machine for a known agent framework. Project-level markers in `cwd` win
 * (`.claude`/`.mcp.json` → claude-code, `openclaw.json` → openclaw, `config.yaml`+`SOUL.md` →
 * hermes; all install into cwd). Otherwise the user-level install decides:
 * `~/.claude` (installs into cwd), `$OPENCLAW_STATE_DIR` or `~/.openclaw/openclaw.json`,
 * `$HERMES_HOME` or `~/.hermes`. Throws AmbiguousTargetError when more than one framework is
 * found at the deciding level. Returns null if none is found (caller defaults to claude-code in
 * cwd and says so).
 */
export async function detectTarget(input: DetectInput): Promise<TargetGuess | null> {
  const project = await detectProject(input.cwd);
  if (project.length > 0) return pickOne(input.cwd, project);
  return pickOne(input.home, await detectHome(input));
}
