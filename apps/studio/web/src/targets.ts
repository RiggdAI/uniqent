import {
  PROJECT_MARKERS,
  projectTargets,
  type ProjectMarker,
  type TargetId,
} from '@uniqent/builder/brain';
import type { FrameworkHomes } from './types';

/** One framework the install panel offers. */
export interface InstallChoice {
  id: TargetId;
  /** Where it installs; null until a folder is picked (Claude Code installs into a project). */
  root: string | null;
  present: boolean;
  /** Why this framework's home is unusable (Rust `framework_homes`), else null. */
  error: string | null;
}

/** One row per framework; preselect only when exactly one is present (ambiguity stays a choice). */
export function installChoices(homes: FrameworkHomes): {
  choices: InstallChoice[];
  preselected: TargetId | null;
} {
  const choices: InstallChoice[] = [
    { id: 'claude-code', root: null, present: homes.claudeCodeUser, error: null },
    ...homes.targets.map((t) => ({ id: t.id, root: t.root, present: t.present, error: t.error })),
  ];
  const present = choices.filter((c) => c.present);
  return { choices, preselected: present.length === 1 ? present[0]!.id : null };
}

const isMarker = (name: string): name is ProjectMarker =>
  (PROJECT_MARKERS as readonly string[]).includes(name);

/** A picked folder's project markers → the frameworks it holds (rules from @uniqent/builder/brain projectTargets). */
export function folderChoices(dir: string, present: string[]): InstallChoice[] {
  const unknown = present.filter((name) => !isMarker(name));
  if (unknown.length > 0)
    throw new Error(
      `not a project marker: ${unknown.join(', ')} (expected ${PROJECT_MARKERS.join(', ')})`,
    );
  return projectTargets(dir, new Set(present.filter(isMarker))).map((t) => ({
    id: t.id,
    root: t.configRoot,
    present: true,
    error: null,
  }));
}
