import type { Bundle } from '@uniqent/core/pure';
import {
  assertMcpCredentialScope,
  assertNoEnvReferences,
  displayPath,
  joinPath,
  OWNER_ONLY,
  readText,
  requiredCredentialRefs,
  sameBytes,
  type FileRef,
  type InputRequest,
  type InstallPlan,
  type Lossiness,
  type OutputWrite,
  type ReadFiles,
  type ResolvedCredentials,
  type TargetContext,
  type Translation,
} from '@uniqent/adapter-sdk/pure';
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
import {
  agentsBody,
  DEFAULT_BOOTSTRAP_MAX_CHARS,
  memoryBody,
  resolveWorkspace,
  soulBody,
  userBody,
  withManagedSection,
  workspaceRef,
} from './workspace.js';

/** OpenClaw's state-dir files (see ./config.ts and ./env.ts) and the workspace skills dir. */
export const CONFIG_FILE = 'openclaw.json';
export const ENV_FILE = '.env';
export const SKILLS_DIR = 'skills';
const SECTION_FILES = ['SOUL.md', 'AGENTS.md', 'USER.md', 'MEMORY.md'];

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

/** openclaw.json as read: its absolute path (for errors), raw text and parsed object ({} if absent). */
export interface LoadedConfig {
  file: string;
  raw: string | undefined;
  config: JsonObject;
}

/** Parse the openclaw.json read so far (an absent file is an empty config). */
export function loadConfig(read: ReadFiles, ctx: TargetContext): LoadedConfig {
  const file = joinPath(ctx.root, CONFIG_FILE);
  const raw = readText(read, ctx.root, CONFIG_FILE);
  return { file, raw, config: raw === undefined ? {} : parseConfig(file, raw) };
}

/** The agent workspace the loaded config points at (default `<root>/workspace`). */
export function workspaceOf(ctx: TargetContext, loaded: LoadedConfig): string {
  return resolveWorkspace(ctx, configuredWorkspace(loaded.file, loaded.config));
}

const bundleSkills = (bundle: Bundle): string[] =>
  bundle.list().filter((p) => p.startsWith(`${SKILLS_DIR}/`));

/**
 * Files the install reads: openclaw.json and .env in the state dir, plus the managed workspace
 * files and every bundle skill target in the workspace that openclaw.json names — so the first
 * round (nothing read yet) asks for the default workspace and a configured one adds a second
 * round. A hostile skill path throws PathEscapeError here, before anything is read.
 */
export function inputs(bundle: Bundle, read: ReadFiles, ctx: TargetContext): InputRequest {
  const workspace = workspaceOf(ctx, loadConfig(read, ctx));
  const files: FileRef[] = [
    { root: ctx.root, path: CONFIG_FILE },
    { root: ctx.root, path: ENV_FILE },
    ...[...SECTION_FILES, ...bundleSkills(bundle)].map((name) =>
      workspaceRef(ctx, workspace, name),
    ),
  ];
  return { files, finds: [] };
}

interface FileWrite {
  ref: FileRef;
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
}

function sameJson(a: JsonObject | undefined, b: JsonObject): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

function draftInstall(bundle: Bundle, read: ReadFiles, ctx: TargetContext): Draft {
  assertNoEnvReferences(bundle);
  const loaded = loadConfig(read, ctx);
  const { file: configPath, raw, config: existing } = loaded;
  const workspace = workspaceOf(ctx, loaded);
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
    const ref = workspaceRef(ctx, workspace, name);
    const content = withManagedSection(
      joinPath(ref.root, ref.path),
      readText(read, ref.root, ref.path),
      body,
    );
    files.push({ ref, summary, content });
    if (content.length > maxChars)
      lossiness.push({
        component: `workspace ${name}`,
        issue: `${content.length} chars exceeds OpenClaw's per-file bootstrap limit (agents.defaults.bootstrapMaxChars = ${maxChars}); OpenClaw truncates it when injecting into the prompt.`,
        action: 'truncated',
      });
  }
  for (const path of bundle.list()) {
    if (!path.startsWith(`${SKILLS_DIR}/`)) continue;
    const bytes = bundle.get(path);
    if (bytes === undefined) continue;
    const ref = workspaceRef(ctx, workspace, path);
    const prior = read.get(joinPath(ref.root, ref.path));
    if (prior !== undefined && !sameBytes(prior, bytes))
      lossiness.push({
        component: `skill ${path}`,
        issue: 'replaces an existing, different workspace skill file.',
        action: 'transformed',
      });
    files.push({ ref, summary: 'skill file', content: bytes });
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
      ref: { root: ctx.root, path: CONFIG_FILE },
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
  };
}

const envRef = (ctx: TargetContext): FileRef => ({ root: ctx.root, path: ENV_FILE });

function planOf(draft: Draft, ctx: TargetContext): InstallPlan {
  const writes = draft.files.map((f) => ({
    path: displayPath(ctx.root, f.ref),
    summary: f.summary,
  }));
  if (draft.credentialRefs.length > 0)
    writes.push({
      path: displayPath(ctx.root, envRef(ctx)),
      summary: 'credential values (mode 0600)',
    });
  return {
    writes,
    mcpRegistrations: draft.mcpRegistrations,
    channelRegistrations: draft.channelRegistrations,
    lossiness: draft.lossiness,
    requiresCredentials: draft.credentialRefs,
  };
}

/** The install plan for `bundle` against the files `inputs()` read. */
export function planInstall(bundle: Bundle, read: ReadFiles, ctx: TargetContext): InstallPlan {
  return planOf(draftInstall(bundle, read, ctx), ctx);
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

const ENCODER = new TextEncoder();

/**
 * Every file the install writes, in order: the workspace + config files, then the credential
 * values merged into an owner-only `.env`. Fails on any missing credential before returning.
 */
export function translate(
  bundle: Bundle,
  read: ReadFiles,
  resolved: ResolvedCredentials,
  ctx: TargetContext,
): Translation {
  const draft = draftInstall(bundle, read, ctx);
  const values = envValues(draft, resolved);
  const envMerge =
    Object.keys(values).length > 0
      ? mergeEnvFile(readText(read, ctx.root, ENV_FILE), values)
      : undefined;

  const writes: OutputWrite[] = draft.files.map((f) => ({
    ...f.ref,
    bytes: typeof f.content === 'string' ? ENCODER.encode(f.content) : f.content,
    mode: null,
  }));
  const notes = draft.lossiness.map((l) => `${l.action}: ${l.component} — ${l.issue}`);
  if (envMerge !== undefined) {
    // .env holds real secrets: owner-only, which also tightens a pre-existing file.
    writes.push({ ...envRef(ctx), bytes: ENCODER.encode(envMerge.content), mode: OWNER_ONLY });
    const envDisplay = displayPath(ctx.root, envRef(ctx));
    if (envMerge.replaced.length > 0)
      notes.push(
        `transformed: ${envDisplay} — replaces your existing, different value of ${envMerge.replaced.join(', ')}.`,
      );
    notes.push(
      `credentials stored in ${envDisplay} (mode 0600) as ${Object.keys(values).join(', ')}`,
    );
  }
  return { plan: planOf(draft, ctx), writes, notes };
}
