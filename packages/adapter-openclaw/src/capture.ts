import type { Bundle } from '@uniqent/core/pure';
import {
  joinPath,
  readText,
  type InputRequest,
  type ReadFiles,
  type TargetContext,
} from '@uniqent/adapter-sdk/pure';
import { Brain } from '@uniqent/builder/brain';
import { parseMemoryMarkdown, parseProfile } from '@uniqent/builder/memory';
import type { CredentialRequirement, McpServer } from '@uniqent/spec';
import { objectAt, OpenClawConfigError } from './config.js';
import type { JsonObject, JsonValue } from './config.js';
import { CONFIG_FILE, knownWorkspace, loadConfig, SKILLS_DIR, workspaceOf } from './translate.js';
import { withoutMarkers, workspaceRef } from './workspace.js';

/**
 * Capture an OpenClaw setup (`root` = the state dir) back into a canonical bundle:
 * openclaw.json `mcp.servers` + `channels.{telegram,discord}`, and the workspace's
 * SOUL.md/IDENTITY.md (persona), AGENTS.md (policies), USER.md (profile), MEMORY.md (facts)
 * and `skills/`. Episodic MEMORY.md items are kept (ids `e1…`); the export drops them with
 * `scrubPrivateMemory`. Secret values never leave the machine: every MCP env value and auth header
 * becomes a credential requirement (a `${VAR}` reference keeps its name, a literal is captured
 * without its value), since those commonly hold secrets. command/args/url are kept verbatim
 * (a `${HOME}`-style reference there is ordinary config, not a credential).
 */

const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
const HAS_ENV_REF = /\$\{[A-Z_][A-Z0-9_]*\}/;
const EPOCH = '1970-01-01T00:00:00.000Z';
const CAPTURED_HELP =
  'Re-supplied locally at install; captured from the source agent without its value.';

type CredType = CredentialRequirement['type'];
interface Capture {
  refs: Map<string, { type: CredType; consumedBy: Set<string> }>;
}

function need(capture: Capture, ref: string, type: CredType, consumer: string): string {
  const entry = capture.refs.get(ref) ?? { type, consumedBy: new Set<string>() };
  entry.consumedBy.add(consumer);
  capture.refs.set(ref, entry);
  return ref;
}

/** A credential ref from an env var name (`GITHUB_PAT` → `github_pat`, the install inverse). */
function refFor(envVar: string): string {
  return envVar.toLowerCase();
}

/** Rewrite `${VAR}` references to `${credentialRef:var}` placeholders, recording each ref. */
function fromEnvRefs(capture: Capture, value: string, consumer: string): string {
  return value.replace(ENV_REF, (_whole, name: string) => {
    const ref = need(capture, refFor(name), 'envVar', consumer);
    return `\${credentialRef:${ref}}`;
  });
}

function slugPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function asString(file: string, value: JsonValue | undefined, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new OpenClawConfigError(file, `"${path}" is not a string`);
  return value;
}

function asScalarRecord(
  file: string,
  value: JsonValue | undefined,
  path: string,
): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new OpenClawConfigError(file, `"${path}" is not an object`);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean')
      throw new OpenClawConfigError(file, `"${path}.${k}" is not a string, number or boolean`);
    out[k] = String(v);
  }
  return out;
}

function asStringArray(
  file: string,
  value: JsonValue | undefined,
  path: string,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    throw new OpenClawConfigError(file, `"${path}" is not an array of strings`);
  return value as string[];
}

/** The ref a header value needs: its `${VAR}` reference, or a captured-without-value ref. */
function headerRef(
  capture: Capture,
  id: string,
  header: string,
  value: string,
  type: CredType,
): string {
  const m = /\$\{([A-Z_][A-Z0-9_]*)\}/.exec(value);
  const ref = m?.[1] ? refFor(m[1]) : `${slugPart(id)}_${slugPart(header)}`;
  return need(capture, ref, type, `mcp:${id}`);
}

function toServer(file: string, capture: Capture, id: string, entry: JsonObject): McpServer {
  const at = `mcp.servers.${id}`;
  const consumer = `mcp:${id}`;
  const command = asString(file, entry.command, `${at}.command`);
  const url = asString(file, entry.url, `${at}.url`);
  const transport =
    asString(file, entry.transport, `${at}.transport`) ?? (command ? 'stdio' : 'streamable-http');
  if (transport !== 'stdio' && transport !== 'sse' && transport !== 'streamable-http')
    throw new OpenClawConfigError(file, `"${at}.transport" is not stdio|sse|streamable-http`);
  const include = asStringArray(
    file,
    objectAt(file, entry, 'toolFilter', `${at}.toolFilter`)?.include,
    `${at}.toolFilter.include`,
  );
  const tools: McpServer['tools'] = { include: include ?? 'all' };

  if (transport === 'stdio') {
    if (command === undefined)
      throw new OpenClawConfigError(file, `"${at}" is stdio but has no command`);
    const args = asStringArray(file, entry.args, `${at}.args`);
    const env = Object.fromEntries(
      Object.entries(asScalarRecord(file, entry.env, `${at}.env`)).map(([k, v]) => [
        k,
        HAS_ENV_REF.test(v)
          ? fromEnvRefs(capture, v, consumer)
          : `\${credentialRef:${need(capture, `${slugPart(id)}_${slugPart(k)}`, 'envVar', consumer)}}`,
      ]),
    );
    return {
      id,
      transport,
      command,
      ...(args ? { args } : {}),
      ...(Object.keys(env).length > 0 ? { env } : {}),
      auth: { type: 'none' },
      tools,
    };
  }

  if (url === undefined)
    throw new OpenClawConfigError(file, `"${at}" is ${transport} but has no url`);
  const headers = asScalarRecord(file, entry.headers, `${at}.headers`);
  const authz = Object.keys(headers).find((h) => h.toLowerCase() === 'authorization');
  const other = Object.keys(headers).find((h) => h.toLowerCase() !== 'authorization');
  let auth: McpServer['auth'] = { type: 'none' };
  if (entry.auth === 'oauth') auth = { type: 'oauth2' };
  else if (authz && /^Bearer\s/i.test(headers[authz] ?? ''))
    auth = {
      type: 'bearer',
      credentialRef: headerRef(capture, id, 'token', headers[authz] ?? '', 'bearer'),
    };
  else if (other)
    auth = {
      type: 'header',
      headerName: other,
      credentialRef: headerRef(capture, id, other, headers[other] ?? '', 'header'),
    };
  return { id, transport, url, auth, tools };
}

const CHANNEL_TOKEN_FIELD = { telegram: 'botToken', discord: 'token' } as const;
const WORKSPACE_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'USER.md', 'MEMORY.md'];
const SKILL_FILE = 'SKILL.md';
const SKILL_RE = /^([^/]+)\/SKILL\.md$/;

/**
 * Files a capture reads: openclaw.json, then (once it is read) the workspace files it maps and
 * every SKILL.md under skills/ — only in the workspace openclaw.json names.
 */
export function captureInputs(
  read: ReadFiles,
  ctx: TargetContext,
  asked: ReadonlySet<string>,
): InputRequest {
  const workspace = knownWorkspace(read, ctx, asked);
  if (workspace === undefined) return { files: [{ root: ctx.root, path: CONFIG_FILE }], finds: [] };
  const skills = workspaceRef(ctx, workspace, SKILLS_DIR);
  return {
    files: [
      { root: ctx.root, path: CONFIG_FILE },
      ...WORKSPACE_FILES.map((name) => workspaceRef(ctx, workspace, name)),
    ],
    finds: [{ root: skills.root, dir: skills.path, fileName: SKILL_FILE, skipDirs: [] }],
  };
}

/** Names of the workspace skills OpenClaw loads (`skills/<name>/SKILL.md`, depth 1), sorted. */
function skillNames(read: ReadFiles, ctx: TargetContext, workspace: string): string[] {
  const skills = workspaceRef(ctx, workspace, SKILLS_DIR);
  const prefix = joinPath(joinPath(skills.root, skills.path), '');
  return [...read.keys()]
    .filter((k) => k.startsWith(prefix))
    .map((k) => SKILL_RE.exec(k.slice(prefix.length))?.[1])
    .filter((name): name is string => name !== undefined)
    .sort();
}

function captureWorkspace(
  brain: Brain,
  files: ReadFiles,
  ctx: TargetContext,
  workspace: string,
): void {
  const read = (name: string) => {
    const ref = workspaceRef(ctx, workspace, name);
    const text = readText(files, ref.root, ref.path);
    return text === undefined ? undefined : withoutMarkers(text);
  };
  const soul = read('SOUL.md');
  const identity = read('IDENTITY.md');
  const persona = [soul, identity ? `## Identity\n\n${identity}` : undefined]
    .filter(Boolean)
    .join('\n\n');
  if (persona) brain.setPersona(persona);
  const agents = read('AGENTS.md');
  if (agents) brain.setPolicies(agents);
  const user = read('USER.md');
  if (user) {
    const profile = parseProfile(user);
    if (Object.keys(profile).length > 0) brain.setProfile(profile);
  }
  const memory = read('MEMORY.md');
  let facts = 0;
  let episodes = 0;
  for (const item of memory ? parseMemoryMarkdown(memory) : []) {
    brain.addMemory({
      // Own counters: fact ids stay m1… whether or not episodic items are interleaved.
      id: item.kind === 'episodic' ? `e${++episodes}` : `m${++facts}`,
      kind: item.kind,
      text: item.text,
      source: 'openclaw:MEMORY.md',
      createdAt: EPOCH,
      ...(item.tags.length > 0 ? { tags: item.tags } : {}),
    });
  }

  // skillNames() only lists skills whose SKILL.md was read.
  for (const name of skillNames(files, ctx, workspace)) {
    const ref = workspaceRef(ctx, workspace, `${SKILLS_DIR}/${name}/${SKILL_FILE}`);
    brain.addSkill(name, readText(files, ref.root, ref.path)!);
  }
}

/** Capture an OpenClaw state dir (`ctx.root`) from the files `captureInputs()` read. */
export function capture(read: ReadFiles, ctx: TargetContext): Bundle {
  const brain = Brain.create({
    name: 'captured-openclaw-agent',
    displayName: 'Captured OpenClaw Agent',
    version: '0.1.0',
    description: 'Captured from an OpenClaw setup.',
    author: { name: 'unknown' },
    license: 'CC0-1.0',
    tags: [],
  });
  const loaded = loadConfig(read, ctx);
  const { file, config } = loaded;
  const capture: Capture = { refs: new Map() };

  const servers =
    objectAt(file, objectAt(file, config, 'mcp', 'mcp') ?? {}, 'servers', 'mcp.servers') ?? {};
  for (const id of Object.keys(servers)) {
    const entry = objectAt(file, servers, id, `mcp.servers.${id}`);
    if (entry) brain.addMcpServer(toServer(file, capture, id, entry));
  }

  const channels = objectAt(file, config, 'channels', 'channels') ?? {};
  for (const [kind, field] of Object.entries(CHANNEL_TOKEN_FIELD)) {
    const block = objectAt(file, channels, kind, `channels.${kind}`);
    const token = block && asString(file, block[field], `channels.${kind}.${field}`);
    if (token === undefined) continue;
    const m = /^\$\{([A-Z_][A-Z0-9_]*)\}$/.exec(token);
    const ref = need(
      capture,
      m?.[1] ? refFor(m[1]) : `${kind}_bot_token`,
      'apiKey',
      `channel:${kind}`,
    );
    brain.addChannel({ id: kind, kind, credentialRef: ref });
  }

  for (const [ref, { type, consumedBy }] of capture.refs) {
    brain.addCredential({
      ref,
      label: `${ref} (captured from OpenClaw)`,
      type,
      consumedBy: [...consumedBy].sort(),
      required: true,
      help: CAPTURED_HELP,
    });
  }

  captureWorkspace(brain, read, ctx, workspaceOf(ctx, loaded));
  return brain.toBundle();
}
