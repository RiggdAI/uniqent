import { chmod, mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { Bundle } from '@uniqent/core';
import {
  assertMcpCredentialScope,
  assertNoEnvReferences,
  requiredCredentialRefs,
  resolveInside,
} from '@uniqent/adapter-sdk';
import type {
  Adapter,
  DetectResult,
  ExportOptions,
  InstallOptions,
  InstallPlan,
  InstallResult,
  Lossiness,
  ResolvedCredentials,
} from '@uniqent/adapter-sdk';
import {
  configuredBootstrapMaxChars,
  configuredWorkspace,
  isJson5Only,
  mapChannels,
  mcpCredentialRefs,
  mergeConfig,
  objectAt,
  parseConfig,
  serializeConfig,
  toOpenClawMcp,
} from './config.js';
import type { JsonObject } from './config.js';
import { envName, mergeEnvFile } from './env.js';
import { exportOpenClaw } from './export.js';
import { isNotFound, readOptional, readOptionalBytes } from './fs.js';
import {
  agentsBody,
  DEFAULT_BOOTSTRAP_MAX_CHARS,
  memoryBody,
  resolveWorkspace,
  soulBody,
  userBody,
  withManagedSection,
} from './workspace.js';

export { ManagedSectionError, MANAGED_BEGIN, MANAGED_END } from './workspace.js';
export { OpenClawConfigError } from './config.js';
export { EnvValueEncodingError, InvalidEnvNameError } from './env.js';

/**
 * OpenClaw adapter. `root` is the OpenClaw STATE DIR (`~/.openclaw`, or `$OPENCLAW_STATE_DIR`):
 * - `<root>/openclaw.json` — merged (never overwritten): `mcp.servers.<id>` and mappable
 *   `channels.<kind>` only, with `${VAR}` credential references (see ./config.ts)
 * - `<root>/.env` — the credential values, merged, mode 0600 (see ./env.ts)
 * - the agent workspace (`agents.defaults.workspace`, else `<root>/workspace`): managed sections
 *   in SOUL.md / AGENTS.md / USER.md / MEMORY.md, plus `skills/` (see ./workspace.ts)
 */

/** A credential the install needs has no resolved value. */
export class MissingCredentialError extends Error {
  constructor(readonly refs: string[]) {
    super(
      `missing credential value(s) for ${refs.join(', ')}: openclaw.json would reference an unset ` +
        'env var and OpenClaw refuses to load such a config; resolve every credential before apply()',
    );
    this.name = 'MissingCredentialError';
  }
}

/** Two credential refs map to the same env var name. */
export class EnvNameCollisionError extends Error {
  constructor(
    readonly envVar: string,
    readonly refs: string[],
  ) {
    super(
      `credential refs ${refs.join(' and ')} both map to env var ${envVar}; rename one in the bundle`,
    );
    this.name = 'EnvNameCollisionError';
  }
}

interface FileWrite {
  abs: string;
  display: string;
  summary: string;
  content: string | Uint8Array;
}

/** Everything install derives from the bundle + current on-disk state, before any write. */
interface Draft {
  files: FileWrite[];
  lossiness: Lossiness[];
  mcpRegistrations: string[];
  channelRegistrations: string[];
  /** Refs whose values go into `.env`. */
  credentialRefs: string[];
  /** Refs openclaw.json references via `${VAR}`; each must be resolved. */
  referencedRefs: string[];
  envPath: string;
}

function displayPath(root: string, abs: string): string {
  const rel = relative(root, abs);
  return rel.startsWith('..') || isAbsolute(rel) ? abs : rel;
}

function sameJson(a: JsonObject | undefined, b: JsonObject): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

async function draftInstall(bundle: Bundle, root: string): Promise<Draft> {
  assertNoEnvReferences(bundle);
  const configPath = resolveInside(root, 'openclaw.json');
  const raw = await readOptional(configPath);
  const existing = raw === undefined ? {} : parseConfig(configPath, raw);
  const workspace = resolveWorkspace(root, configuredWorkspace(configPath, existing));
  const maxChars = configuredBootstrapMaxChars(configPath, existing) ?? DEFAULT_BOOTSTRAP_MAX_CHARS;
  const files: FileWrite[] = [];
  const lossiness: Lossiness[] = [];

  const sections: Array<[string, string | undefined, string]> = [
    ['SOUL.md', soulBody(bundle), 'persona (managed section)'],
    ['AGENTS.md', agentsBody(bundle), 'policies (managed section)'],
    ['USER.md', userBody(bundle), 'user profile (managed section)'],
    ['MEMORY.md', memoryBody(bundle), 'memory facts (managed section)'],
  ];
  for (const [name, body, summary] of sections) {
    if (body === undefined) continue;
    const abs = resolveInside(workspace, name);
    const content = withManagedSection(abs, await readOptional(abs), body);
    files.push({ abs, display: displayPath(root, abs), summary, content });
    if (content.length > maxChars)
      lossiness.push({
        component: `workspace ${name}`,
        issue: `${content.length} chars exceeds OpenClaw's per-file bootstrap limit (agents.defaults.bootstrapMaxChars = ${maxChars}); OpenClaw truncates it when injecting into the prompt.`,
        action: 'truncated',
      });
  }
  for (const path of bundle.list()) {
    if (!path.startsWith('skills/')) continue;
    const bytes = bundle.get(path);
    if (bytes === undefined) continue;
    const abs = resolveInside(workspace, path);
    const prior = await readOptionalBytes(abs);
    if (prior !== undefined && !Buffer.from(prior).equals(Buffer.from(bytes)))
      lossiness.push({
        component: `skill ${path}`,
        issue: 'replaces an existing, different workspace skill file.',
        action: 'transformed',
      });
    files.push({ abs, display: displayPath(root, abs), summary: 'skill file', content: bytes });
  }

  const servers = bundle.mcpServers();
  const existingServers =
    objectAt(
      configPath,
      objectAt(configPath, existing, 'mcp', 'mcp') ?? {},
      'servers',
      'mcp.servers',
    ) ?? {};
  const mcpEntries: Record<string, JsonObject> = {};
  for (const s of servers) {
    assertMcpCredentialScope(bundle, s.id, mcpCredentialRefs(s));
    const entry = toOpenClawMcp(s);
    mcpEntries[s.id] = entry;
    const prior = objectAt(configPath, existingServers, s.id, `mcp.servers.${s.id}`);
    if (prior !== undefined && !sameJson(prior, entry))
      lossiness.push({
        component: `mcp:${s.id}`,
        issue: `replaces your existing mcp.servers.${s.id} entry in openclaw.json.`,
        action: 'transformed',
      });
    if (s.auth.type === 'oauth2')
      lossiness.push({
        component: `mcp:${s.id}`,
        issue:
          'registered with auth: "oauth"; complete the sign-in through OpenClaw (a bundle credential is not wired into the server).',
        action: 'transformed',
      });
    if (s.tools.include !== 'all' && s.tools.include.length === 0)
      lossiness.push({
        component: `mcp:${s.id}`,
        issue:
          'empty tool allowlist; registered with enabled: false (OpenClaw toolFilter.include needs >= 1 entry).',
        action: 'transformed',
      });
  }

  const existingChannels = objectAt(configPath, existing, 'channels', 'channels') ?? {};
  const channelEntries: Record<string, JsonObject> = {};
  const channelRegistrations: string[] = [];
  for (const { channel, fields, reason } of mapChannels(bundle.channels())) {
    if (fields === undefined) {
      lossiness.push({
        component: `channel:${channel.id}`,
        issue: `${reason}.`,
        action: 'dropped',
      });
      continue;
    }
    channelEntries[channel.kind] = fields;
    channelRegistrations.push(channel.id);
    const prior = objectAt(configPath, existingChannels, channel.kind, `channels.${channel.kind}`);
    const replaced = Object.keys(fields).filter(
      (k) => prior?.[k] !== undefined && JSON.stringify(prior[k]) !== JSON.stringify(fields[k]),
    );
    if (replaced.length > 0)
      lossiness.push({
        component: `channel:${channel.id}`,
        issue: `replaces your existing ${replaced.map((k) => `channels.${channel.kind}.${k}`).join(', ')} in openclaw.json.`,
        action: 'transformed',
      });
    if (channel.config && Object.keys(channel.config).length > 0)
      lossiness.push({
        component: `channel:${channel.id}`,
        issue: `channel config (${Object.keys(channel.config).join(', ')}) is not mapped; set it under channels.${channel.kind} yourself.`,
        action: 'dropped',
      });
  }

  if (servers.length > 0 || channelRegistrations.length > 0) {
    const merged = mergeConfig(configPath, existing, mcpEntries, channelEntries);
    files.push({
      abs: configPath,
      display: displayPath(root, configPath),
      summary: raw === undefined ? 'new config: mcp + channels' : 'merge mcp + channels',
      content: serializeConfig(merged),
    });
    if (raw !== undefined && isJson5Only(raw))
      lossiness.push({
        component: 'openclaw.json',
        issue:
          'your config uses JSON5 syntax (comments, trailing commas, unquoted keys); it is rewritten as plain JSON, so comments are not preserved.',
        action: 'transformed',
      });
  }

  if (bundle.memoryEpisodic().length > 0)
    lossiness.push({
      component: 'memory episodic',
      issue: `${bundle.memoryEpisodic().length} episodic item(s) not installed; Uniqent only writes curated memory to MEMORY.md.`,
      action: 'dropped',
    });
  if (bundle.tasks().length > 0)
    lossiness.push({
      component: 'tasks',
      issue:
        'OpenClaw cron jobs live in the gateway-managed job store (openclaw cron), not openclaw.json; recreate them with `openclaw cron add`.',
      action: 'dropped',
    });
  if (bundle.tools().length > 0)
    lossiness.push({
      component: 'tools',
      issue: 'OpenClaw has no per-brain tool declarations; dropped.',
      action: 'dropped',
    });
  if (bundle.runtime() !== undefined)
    lossiness.push({
      component: 'runtime config',
      issue:
        'model/autonomy/tool allowlist are global OpenClaw settings (agents.defaults, tools.*) and are not changed by an install.',
      action: 'dropped',
    });

  return {
    files,
    lossiness,
    mcpRegistrations: servers.map((s) => s.id),
    channelRegistrations,
    credentialRefs: requiredCredentialRefs(bundle, ['mcp', 'channel']),
    referencedRefs: [
      ...new Set([
        ...servers.flatMap(mcpCredentialRefs),
        ...bundle.channels().flatMap((c) => {
          const ref = c.credentialRef;
          return ref !== undefined && channelRegistrations.includes(c.id) ? [ref] : [];
        }),
      ]),
    ],
    envPath: resolveInside(root, '.env'),
  };
}

/** `.env` values keyed by env var name; throws on a missing value or a name collision. */
function envValues(draft: Draft, resolved: ResolvedCredentials): Record<string, string> {
  const refs = [...new Set([...draft.credentialRefs, ...draft.referencedRefs])];
  const missing = refs.filter((ref) => !resolved[ref]);
  if (missing.length > 0) throw new MissingCredentialError(missing);
  const byName = new Map<string, string>();
  const values: Record<string, string> = {};
  for (const ref of refs) {
    const name = envName(ref);
    const other = byName.get(name);
    if (other !== undefined) throw new EnvNameCollisionError(name, [other, ref]);
    byName.set(name, ref);
    values[name] = resolved[ref] as string;
  }
  return values;
}

async function writeOut(abs: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
}

/** Write an owner-only (0600) file; chmod also tightens a pre-existing file. */
async function writeSecret(abs: string, content: string): Promise<void> {
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, { mode: 0o600 });
  await chmod(abs, 0o600);
}

export const openClawAdapter: Adapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',

  async detect({ root }): Promise<DetectResult> {
    const configRoot = root ?? process.env.OPENCLAW_STATE_DIR ?? join(homedir(), '.openclaw');
    try {
      await stat(join(configRoot, 'openclaw.json'));
      return { present: true, configRoot };
    } catch (err) {
      if (isNotFound(err)) return { present: false, configRoot };
      throw err;
    }
  },

  async plan(bundle: Bundle, { root }: InstallOptions): Promise<InstallPlan> {
    const draft = await draftInstall(bundle, root);
    const writes = draft.files.map((f) => ({ path: f.display, summary: f.summary }));
    if (draft.credentialRefs.length > 0)
      writes.push({
        path: displayPath(root, draft.envPath),
        summary: 'credential values (mode 0600)',
      });
    return {
      writes,
      mcpRegistrations: draft.mcpRegistrations,
      channelRegistrations: draft.channelRegistrations,
      lossiness: draft.lossiness,
      requiresCredentials: draft.credentialRefs,
    };
  },

  async apply(
    bundle: Bundle,
    _plan: InstallPlan,
    resolved: ResolvedCredentials,
    { root }: InstallOptions,
  ): Promise<InstallResult> {
    // Compute every output (and fail on any missing credential) before touching the disk.
    const draft = await draftInstall(bundle, root);
    const values = envValues(draft, resolved);
    const envMerge =
      Object.keys(values).length > 0
        ? mergeEnvFile(await readOptional(draft.envPath), values)
        : undefined;

    const written: string[] = [];
    for (const f of draft.files) {
      await writeOut(f.abs, f.content);
      written.push(f.display);
    }
    const notes = draft.lossiness.map((l) => `${l.action}: ${l.component} — ${l.issue}`);
    if (envMerge !== undefined) {
      await writeSecret(draft.envPath, envMerge.content);
      const envDisplay = displayPath(root, draft.envPath);
      written.push(envDisplay);
      if (envMerge.replaced.length > 0)
        notes.push(
          `transformed: ${envDisplay} — replaces your existing, different value of ${envMerge.replaced.join(', ')}.`,
        );
      notes.push(
        `credentials stored in ${envDisplay} (mode 0600) as ${Object.keys(values).join(', ')}`,
      );
    }
    return { written, notes };
  },

  async export({ root }: ExportOptions): Promise<Bundle> {
    return exportOpenClaw(root);
  },
};
