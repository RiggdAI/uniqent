import { useEffect, useState } from 'react';
import type { TargetId } from '@uniqent/builder/brain';
import { api } from './api';
import { PURE_ADAPTERS } from './install';
import { folderChoices, installChoices, type InstallChoice } from './targets';
import { errorText } from './lib/utils';

/** Rust's refusal of a root outside the picked folders and framework homes (fs_io::allowed_root). */
export const OUTSIDE_ALLOWED = 'outside the folders Studio may use';

interface Pick {
  choices: InstallChoice[];
  target: TargetId | null;
  /** Several frameworks were found and none is preselected. */
  several: boolean;
}

/** `pick` with a folder's frameworks (`found`, from folderChoices) merged in; throws when it holds none and no framework is chosen. */
function withFolder(pick: Pick, dir: string, found: InstallChoice[]): Pick {
  if (found.length === 1) {
    const only = found[0]!;
    // A list from an earlier folder pick may not hold this framework yet.
    const choices = pick.choices.some((c) => c.id === only.id)
      ? pick.choices.map((c) => (c.id === only.id ? only : c))
      : [...pick.choices, only];
    return { choices, target: only.id, several: false };
  }
  if (found.length > 1) return { choices: found, target: null, several: true };
  if (pick.target) {
    const target = pick.target;
    return {
      choices: pick.choices.map((c) => (c.id === target ? { ...c, root: dir, error: null } : c)),
      target,
      several: false,
    };
  }
  throw new Error(`no agent framework found in ${dir}; choose a framework above, then the folder`);
}

export interface TargetPicker {
  pick: Pick;
  /** The selected framework's root, once it has a usable one. */
  root: string | null;
  select: (id: TargetId) => void;
  /** The OS folder picker (Rust grants the folder), then the frameworks it holds. */
  chooseFolder: () => Promise<void>;
}

/**
 * The framework + root choice shared by the install and capture panels: the framework homes
 * (preselected only when exactly one is present), then `dir` (a dropped folder) or a picked
 * folder's markers. `onChange` runs whenever the choice changes; `onError` gets each failure.
 */
export function useTargetPicker(
  dir: string | null,
  onChange: () => void,
  onError: (message: string) => void,
): TargetPicker {
  const [pick, setPick] = useState<Pick>({ choices: [], target: null, several: false });

  const folderPick = async (current: Pick, folder: string): Promise<Pick> =>
    withFolder(current, folder, folderChoices(folder, await api.folderTargets(folder)));

  useEffect(() => {
    api
      .frameworkHomes()
      .then(async (homes) => {
        const found = installChoices(homes);
        const initial: Pick = {
          choices: found.choices,
          target: found.preselected,
          several: found.preselected === null && found.choices.filter((c) => c.present).length > 1,
        };
        setPick(initial);
        if (dir) setPick(await folderPick(initial, dir));
      })
      .catch((e: unknown) => onError(errorText(e)));
    // Mount only: a new `dir` remounts the panel (see its `key`).
  }, []);

  const choice = pick.choices.find((c) => c.id === pick.target) ?? null;
  return {
    pick,
    root: choice && choice.error === null ? choice.root : null,
    select(id) {
      setPick((p) => ({ ...p, target: id, several: false }));
      onChange();
    },
    async chooseFolder() {
      onError('');
      try {
        const folder = await api.chooseFolder();
        if (!folder) return;
        const next = await folderPick(pick, folder);
        onChange();
        setPick(next);
      } catch (e) {
        onError(errorText(e));
      }
    },
  };
}

/** One radio row per framework: found or not, its root (or "choose a project folder") and any home error. */
export function TargetChoiceList({ name, picker }: { name: string; picker: TargetPicker }) {
  const { pick, select } = picker;
  return (
    <div className="space-y-1.5">
      {pick.several && (
        <p data-testid={`${name}-several`} className="text-xs text-amber-400">
          Several agent frameworks found — choose one
        </p>
      )}
      {pick.choices.map((c) => (
        <label key={c.id} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={name}
            data-testid={`${name}-target-${c.id}`}
            checked={pick.target === c.id}
            onChange={() => select(c.id)}
          />
          <span className="min-w-0">
            <span className="font-medium">{PURE_ADAPTERS[c.id].displayName}</span>{' '}
            <span className="text-xs text-muted-foreground">
              {c.present ? 'found' : 'not found'}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {c.root ?? 'choose a project folder'}
            </span>
            {c.error && <span className="block text-xs text-destructive">{c.error}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
