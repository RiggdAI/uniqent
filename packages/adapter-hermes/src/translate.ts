import type { Bundle } from '@uniqent/core';
import {
  assertMcpCredentialScope,
  requiredCredentialRefs,
  resolveInside,
  type InstallPlan,
  type Lossiness,
  type PlanWrite,
} from '@uniqent/adapter-sdk';
import { CHANNEL_TOKEN_ENV } from './channels.js';
import { memoryLimits, mergeMcpServers, readMcpServers } from './config.js';
import { envName } from './env.js';
import { mcpCredentialRefs, toHermesMcp, unmappedAuth } from './mcp.js';
import {
  factCandidates,
  mergeEntries,
  parseEntries,
  profileCandidates,
  type MergedEntries,
} from './memory.js';

/** Hermes' layout under $HERMES_HOME (hermes_cli/config.py, agent/prompt_builder.py, tools/memory_tool.py). */
export const SOUL_FILE = 'SOUL.md';
export const MEMORY_FILE = 'memories/MEMORY.md';
export const USER_FILE = 'memories/USER.md';
export const CONFIG_FILE = 'config.yaml';
export const ENV_FILE = '.env';
const SKILLS_DIR = 'skills';

/** Existing $HERMES_HOME files the install merges into (undefined = file absent). */
export interface HermesHome {
  soul: string | undefined;
  memory: string | undefined;
  user: string | undefined;
  config: string | undefined;
  env: string | undefined;
  /** Existing files at the bundle's `skills/...` paths, keyed by bundle path. */
  skills: Map<string, Uint8Array>;
}

export interface FileWrite {
  path: string;
  content: string | Uint8Array;
}

/** A .env key the install sets, and the credential ref whose resolved value it holds. */
export interface EnvBinding {
  key: string;
  ref: string;
}

export interface Translation {
  plan: InstallPlan;
  /** Every file except .env, whose content needs the resolved credentials. */
  files: FileWrite[];
  env: EnvBinding[];
}

/** A component uses a credential ref the manifest does not declare for it (via `consumedBy`). */
export class UndeclaredCredentialError extends Error {
  constructor(
    readonly ref: string,
    readonly consumer: string,
  ) {
    super(
      `${consumer} uses credential "${ref}", but uniqent.json declares no credential "${ref}" consumed by an mcp/channel component`,
    );
    this.name = 'UndeclaredCredentialError';
  }
}

/** Two different credential refs would be written to the same Hermes .env key. */
export class EnvKeyConflictError extends Error {
  constructor(
    readonly key: string,
    readonly refs: [string, string],
  ) {
    super(`.env key ${key} would hold both credential "${refs[0]}" and "${refs[1]}"`);
    this.name = 'EnvKeyConflictError';
  }
}

/** Absolute target of a bundle `skills/...` path; throws PathEscapeError if it leaves skills/. */
export function skillTarget(root: string, path: string): string {
  return resolveInside(resolveInside(root, SKILLS_DIR), path.slice(`${SKILLS_DIR}/`.length));
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function memoryLoss(
  component: string,
  file: string,
  total: number,
  merged: MergedEntries,
  limit: number,
): Lossiness {
  const skipped = merged.skipped.map((s) => `${s.id} (${s.reason})`).join('; ');
  return {
    component,
    action: 'truncated',
    issue:
      `${merged.skipped.length} of ${total} not written to ${file} (${limit}-char budget on the ` +
      `§-joined file; ${plural(merged.existing, 'existing entry', 'existing entries')} kept, ` +
      `file is ${merged.content.length} chars): ${skipped}. Consider an external memory provider.`,
  };
}

/**
 * Translate a bundle against the current $HERMES_HOME state. Pure: the same bundle + state always
 * yields the same plan and file contents, which is what makes apply() idempotent.
 */
export function translate(bundle: Bundle, home: HermesHome, root: string): Translation {
  const writes: PlanWrite[] = [];
  const files: FileWrite[] = [];
  const lossiness: Lossiness[] = [];
  const add = (path: string, summary: string, content: string | Uint8Array) => {
    writes.push({ path, summary });
    files.push({ path, content });
  };

  const persona = bundle.persona();
  if (persona !== undefined) {
    const policies = bundle.policies();
    add(
      SOUL_FILE,
      home.soul === undefined
        ? 'identity / system prompt'
        : 'identity / system prompt (replaces existing SOUL.md)',
      policies ? `${persona.trim()}\n\n## Policies\n\n${policies.trim()}\n` : persona,
    );
  }

  const limits = memoryLimits(home.config);
  const facts = bundle.memoryFacts();
  if (facts.length > 0) {
    const merged = mergeEntries(
      parseEntries(home.memory ?? ''),
      factCandidates(facts),
      limits.memory,
    );
    add(
      MEMORY_FILE,
      `${plural(merged.added.length, 'memory fact', 'memory facts')} added, ${merged.alreadyPresent.length} already present, ${merged.existing} existing kept`,
      merged.content,
    );
    if (merged.skipped.length > 0)
      lossiness.push(memoryLoss('memory', MEMORY_FILE, facts.length, merged, limits.memory));
  }
  const profile = bundle.memoryProfile();
  if (profile !== undefined) {
    const candidates = profileCandidates(profile);
    const merged = mergeEntries(parseEntries(home.user ?? ''), candidates, limits.user);
    add(
      USER_FILE,
      `${plural(merged.added.length, 'profile field', 'profile fields')} added, ${merged.alreadyPresent.length} already present, ${merged.existing} existing kept`,
      merged.content,
    );
    if (merged.skipped.length > 0)
      lossiness.push(
        memoryLoss('memory profile', USER_FILE, candidates.length, merged, limits.user),
      );
  }
  const episodic = bundle.memoryEpisodic();
  if (episodic.length > 0)
    lossiness.push({
      component: 'episodic memory',
      action: 'dropped',
      issue: `${plural(episodic.length, 'episodic item', 'episodic items')} not installed: Hermes memory holds only MEMORY.md/USER.md entries (session history lives in its own state.db).`,
    });

  for (const [path, bytes] of bundle.entries()) {
    if (!path.startsWith(`${SKILLS_DIR}/`)) continue;
    skillTarget(root, path);
    const prior = home.skills.get(path);
    if (prior !== undefined && !Buffer.from(prior).equals(Buffer.from(bytes)))
      lossiness.push({
        component: `skill ${path}`,
        action: 'transformed',
        issue: 'replaces an existing, different skill file.',
      });
    add(path, 'skill file', bytes);
  }

  const declared = new Set(requiredCredentialRefs(bundle, ['mcp', 'channel']));
  const env: EnvBinding[] = [];
  const bind = (key: string, ref: string, consumer: string) => {
    if (!declared.has(ref)) throw new UndeclaredCredentialError(ref, consumer);
    const bound = env.find((b) => b.key === key);
    if (bound === undefined) env.push({ key, ref });
    else if (bound.ref !== ref) throw new EnvKeyConflictError(key, [bound.ref, ref]);
  };

  const servers = bundle.mcpServers();
  const existingServers = readMcpServers(home.config);
  for (const s of servers) {
    const refs = mcpCredentialRefs(s);
    assertMcpCredentialScope(bundle, s.id, refs);
    for (const ref of refs) bind(envName(ref), ref, `mcp:${s.id}`);
    const authLoss = unmappedAuth(s);
    if (authLoss !== undefined)
      lossiness.push({ component: `mcp:${s.id}`, action: 'dropped', issue: authLoss });
    const prior = existingServers[s.id];
    if (prior !== undefined && JSON.stringify(prior) !== JSON.stringify(toHermesMcp(s)))
      lossiness.push({
        component: `mcp:${s.id}`,
        action: 'transformed',
        issue: `replaces your existing, different mcp_servers.${s.id} entry in config.yaml.`,
      });
  }
  if (servers.length > 0)
    add(
      CONFIG_FILE,
      `mcp_servers: ${servers.map((s) => s.id).join(', ')} (merged; other keys and comments kept)`,
      mergeMcpServers(
        home.config,
        servers.map((s) => [s.id, toHermesMcp(s)]),
      ),
    );

  const channelRegistrations: string[] = [];
  for (const c of bundle.channels()) {
    const component = `channel:${c.id}`;
    const key = CHANNEL_TOKEN_ENV[c.kind];
    if (key === undefined) {
      lossiness.push({
        component,
        action: 'dropped',
        issue: `Hermes' ${c.kind} gateway needs multi-field platform setup (\`hermes gateway setup\`), not a single token; not installed.`,
      });
      continue;
    }
    if (c.credentialRef === undefined) {
      lossiness.push({
        component,
        action: 'dropped',
        issue: `no credentialRef; Hermes enables ${c.kind} only when ${key} is set in .env.`,
      });
      continue;
    }
    const owner = env.find((b) => b.key === key && b.ref !== c.credentialRef);
    if (owner !== undefined) {
      lossiness.push({
        component,
        action: 'dropped',
        issue: `Hermes reads a single ${key}; it already holds credential "${owner.ref}".`,
      });
      continue;
    }
    bind(key, c.credentialRef, component);
    channelRegistrations.push(c.id);
    if (c.config !== undefined && Object.keys(c.config).length > 0)
      lossiness.push({
        component,
        action: 'dropped',
        issue: `channel config (${Object.keys(c.config).join(', ')}) has no Hermes .env equivalent; set it with \`hermes gateway setup\`.`,
      });
    if (c.kind === 'slack')
      lossiness.push({
        component,
        action: 'transformed',
        issue:
          'token installed as SLACK_BOT_TOKEN; Hermes Slack (Socket Mode) also needs SLACK_APP_TOKEN in .env, which the bundle does not declare.',
      });
  }

  for (const t of bundle.tasks())
    lossiness.push({
      component: `task:${t.id}`,
      action: 'dropped',
      issue:
        t.trigger.type === 'schedule'
          ? `Hermes keeps cron jobs in cron/jobs.json as live scheduler state (computed next_run_at, lock file), not an installable config; recreate with \`hermes cron create '${t.trigger.cron}' <prompt> --name '${t.name}'\`.`
          : `Hermes cron supports only scheduled jobs; a ${t.trigger.type} trigger has no equivalent.`,
    });

  const tools = bundle.tools();
  if (tools.length > 0)
    lossiness.push({
      component: 'tools',
      action: 'dropped',
      issue: `${tools.map((t) => t.id).join(', ')} not installed: Hermes enables built-in tools through toolsets, not per-tool declarations.`,
    });
  const runtime = bundle.runtime();
  if (runtime !== undefined)
    lossiness.push({
      component: 'runtime config',
      action: 'dropped',
      issue: `${Object.keys(runtime).join(', ') || 'runtime settings'} not installed: Hermes' model, autonomy and toolset settings are configured with \`hermes setup\`.`,
    });

  if (env.length > 0)
    writes.push({
      path: ENV_FILE,
      summary: `sets ${env.map((b) => b.key).join(', ')} (merged; other lines kept, existing values of these keys replaced, mode 0600)`,
    });

  return {
    plan: {
      writes,
      mcpRegistrations: servers.map((s) => s.id),
      channelRegistrations,
      lossiness,
      requiresCredentials: [...new Set(env.map((b) => b.ref))],
    },
    files,
    env,
  };
}
