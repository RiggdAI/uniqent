import { homedir } from 'node:os';
import { join } from 'node:path';
import { nodeAdapter, type Adapter, type DetectResult } from '@uniqent/adapter-sdk';
import { exists } from './fs.js';
import { hermesPure } from './pure.js';
import { CONFIG_FILE, SOUL_FILE } from './translate.js';

export * from './pure.js';

/** Hermes' home when no root is given: $HERMES_HOME, else ~/.hermes (hermes_constants.get_hermes_home). */
function defaultHermesHome(): string {
  const env = process.env.HERMES_HOME?.trim();
  return env ? env : join(homedir(), '.hermes');
}

async function detect({ root }: { root?: string }): Promise<DetectResult> {
  const home = root ?? defaultHermesHome();
  const present = (await exists(join(home, CONFIG_FILE))) || (await exists(join(home, SOUL_FILE)));
  return { present, configRoot: home };
}

/** Installs into a Hermes Agent home: `root` is $HERMES_HOME (normally ~/.hermes). */
export const hermesAdapter: Adapter = nodeAdapter(hermesPure, detect);
