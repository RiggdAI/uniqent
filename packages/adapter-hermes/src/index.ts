import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Bundle } from '@uniqent/core';
import {
  resolveInside,
  type Adapter,
  type DetectResult,
  type ExportOptions,
  type InstallOptions,
  type InstallPlan,
  type InstallResult,
  type ResolvedCredentials,
} from '@uniqent/adapter-sdk';
import { mergeEnv } from './env.js';
import { exportHermes } from './export.js';
import { exists, readOptional } from './fs.js';
import {
  CONFIG_FILE,
  ENV_FILE,
  MEMORY_FILE,
  SOUL_FILE,
  USER_FILE,
  translate,
  type HermesHome,
} from './translate.js';

export { MEMORY_MAX, USER_MAX, ENTRY_DELIMITER } from './memory.js';
export { HermesConfigError } from './config.js';
export { DuplicateSkillError } from './export.js';
export { EnvKeyConflictError, UndeclaredCredentialError, skillTarget } from './translate.js';

/** apply() was called without a value for a credential the plan requires. */
export class MissingCredentialError extends Error {
  constructor(readonly refs: string[]) {
    super(`missing resolved credential(s) for Hermes install: ${refs.join(', ')}`);
    this.name = 'MissingCredentialError';
  }
}

/** Hermes' home when no root is given: $HERMES_HOME, else ~/.hermes (hermes_constants.get_hermes_home). */
function defaultHermesHome(): string {
  const env = process.env.HERMES_HOME?.trim();
  return env ? env : join(homedir(), '.hermes');
}

async function readHome(root: string): Promise<HermesHome> {
  const read = (rel: string) => readOptional(resolveInside(root, rel));
  return {
    soul: await read(SOUL_FILE),
    memory: await read(MEMORY_FILE),
    user: await read(USER_FILE),
    config: await read(CONFIG_FILE),
    env: await read(ENV_FILE),
  };
}

/** Installs into a Hermes Agent home: `root` is $HERMES_HOME (normally ~/.hermes). */
export const hermesAdapter: Adapter = {
  id: 'hermes',
  displayName: 'Hermes',

  async detect({ root }): Promise<DetectResult> {
    const home = root ?? defaultHermesHome();
    const present =
      (await exists(join(home, CONFIG_FILE))) || (await exists(join(home, SOUL_FILE)));
    return { present, configRoot: home };
  },

  async plan(bundle: Bundle, { root }: InstallOptions): Promise<InstallPlan> {
    return translate(bundle, await readHome(root), root).plan;
  },

  async apply(
    bundle: Bundle,
    _plan: InstallPlan,
    resolved: ResolvedCredentials,
    { root }: InstallOptions,
  ): Promise<InstallResult> {
    const home = await readHome(root);
    const { plan, files, env } = translate(bundle, home, root);
    const missing = plan.requiresCredentials.filter((ref) => !resolved[ref]);
    if (missing.length > 0) throw new MissingCredentialError(missing);

    const all =
      env.length === 0
        ? files
        : [
            ...files,
            {
              path: ENV_FILE,
              content: mergeEnv(home.env, new Map(env.map((b) => [b.key, resolved[b.ref] ?? '']))),
            },
          ];
    for (const f of all) {
      const target = resolveInside(root, f.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, f.content);
      // .env holds real secrets: owner-only, also when it already existed with a wider mode.
      if (f.path === ENV_FILE) await chmod(target, 0o600);
    }

    return {
      written: all.map((f) => f.path),
      notes: plan.lossiness.map((l) => `${l.action}: ${l.component} — ${l.issue}`),
    };
  },

  async export({ root }: ExportOptions): Promise<Bundle> {
    return exportHermes(root);
  },
};
