import { readdir } from 'node:fs/promises';
import type { Bundle } from '@uniqent/core';
import { resolveInside } from '@uniqent/adapter-sdk';
import { Brain, parseMemoryMarkdown, parseProfile } from '@uniqent/builder';
import type { CredentialRequirement, McpServer } from '@uniqent/spec';
import { configuredWorkspace, objectAt, OpenClawConfigError, parseConfig } from './config.js';
import type { JsonObject, JsonValue } from './config.js';
import { isNotFound, readOptional } from './fs.js';
import { resolveWorkspace, withoutMarkers } from './workspace.js';

/**
 * Capture an OpenClaw setup (`root` = the state dir) back into a canonical bundle:
 * openclaw.json `mcp.servers` + `channels.{telegram,discord}`, and the workspace's
 * SOUL.md/IDENTITY.md (persona), AGENTS.md (policies), USER.md (profile), MEMORY.md (facts)
 * and `skills/`. Secret values never leave the machine: every MCP env value and auth header
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

async function captureWorkspace(brain: Brain, workspace: string): Promise<void> {
  const read = async (name: string) => {
    const text = await readOptional(resolveInside(workspace, name));
    return text === undefined ? undefined : withoutMarkers(text);
  };
  const soul = await read('SOUL.md');
  const identity = await read('IDENTITY.md');
  const persona = [soul, identity ? `## Identity\n\n${identity}` : undefined]
    .filter(Boolean)
    .join('\n\n');
  if (persona) brain.setPersona(persona);
  const agents = await read('AGENTS.md');
  if (agents) brain.setPolicies(agents);
  const user = await read('USER.md');
  if (user) {
    const profile = parseProfile(user);
    if (Object.keys(profile).length > 0) brain.setProfile(profile);
  }
  const memory = await read('MEMORY.md');
  let n = 0;
  for (const item of memory ? parseMemoryMarkdown(memory) : []) {
    if (item.kind === 'episodic') continue; // episodic memory is scrubbed on export by default
    brain.addMemory({
      id: `m${++n}`,
      kind: item.kind,
      text: item.text,
      source: 'openclaw:MEMORY.md',
      createdAt: EPOCH,
      ...(item.tags.length > 0 ? { tags: item.tags } : {}),
    });
  }

  let names: string[] = [];
  try {
    names = await readdir(resolveInside(workspace, 'skills'));
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
  for (const name of names.sort()) {
    const md = await readOptional(resolveInside(workspace, `skills/${name}/SKILL.md`));
    if (md !== undefined) brain.addSkill(name, md);
  }
}

export async function exportOpenClaw(root: string): Promise<Bundle> {
  const brain = Brain.create({
    name: 'captured-openclaw-agent',
    displayName: 'Captured OpenClaw Agent',
    version: '0.1.0',
    description: 'Captured from an OpenClaw setup.',
    author: { name: 'unknown' },
    license: 'CC0-1.0',
    tags: [],
  });
  const file = resolveInside(root, 'openclaw.json');
  const raw = await readOptional(file);
  const config = raw === undefined ? {} : parseConfig(file, raw);
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

  await captureWorkspace(brain, resolveWorkspace(root, configuredWorkspace(file, config)));
  return brain.toBundle();
}
