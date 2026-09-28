import JSON5 from 'json5';
import type { Channel, ChannelKind, McpServer } from '@uniqent/spec';
import { credentialRefsIn, envName, toEnvRefs } from './env.js';

/**
 * openclaw.json (`<stateDir>/openclaw.json`, JSON5). Its root is a zod strictObject: an unknown
 * key makes the Gateway refuse to start (docs.openclaw.ai/gateway/configuration). So Uniqent
 * MERGES into it and only ever writes keys of the real schema:
 * - `mcp.servers.<id>` (src/config/zod-schema.mcp-server.ts, docs.openclaw.ai/tools/mcp)
 * - `channels.telegram.{enabled,botToken}` / `channels.discord.{enabled,token}`
 *   (bundled channel schemas in src/config/bundled-channel-config-metadata.generated.ts)
 * Secrets are `${UPPER_VAR}` references, never values.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

/** openclaw.json exists but is not a usable config object. */
export class OpenClawConfigError extends Error {
  constructor(
    readonly file: string,
    readonly detail: string,
  ) {
    super(`cannot merge into ${file}: ${detail}`);
    this.name = 'OpenClawConfigError';
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse openclaw.json text (JSON5); the root must be an object. */
export function parseConfig(file: string, raw: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON5.parse(raw);
  } catch (err) {
    throw new OpenClawConfigError(file, `invalid JSON5 (${(err as Error).message})`);
  }
  if (!isJsonObject(parsed)) throw new OpenClawConfigError(file, 'the root is not an object');
  return parsed;
}

/** True when the text is JSON5-only (comments, trailing commas, …) and a JSON rewrite loses that. */
export function isJson5Only(raw: string): boolean {
  try {
    JSON.parse(raw);
    return false;
  } catch {
    return true;
  }
}

/** The object at `key`, or undefined when absent; throws when present but not an object. */
export function objectAt(
  file: string,
  obj: JsonObject,
  key: string,
  path: string,
): JsonObject | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new OpenClawConfigError(file, `"${path}" is not an object`);
  return value;
}

/** `agents.defaults.<key>` from the config, when present. */
function agentDefault(file: string, config: JsonObject, key: string): JsonValue | undefined {
  const agents = objectAt(file, config, 'agents', 'agents');
  const defaults = agents && objectAt(file, agents, 'defaults', 'agents.defaults');
  return defaults?.[key];
}

/** `agents.defaults.workspace`, when configured. */
export function configuredWorkspace(file: string, config: JsonObject): string | undefined {
  const value = agentDefault(file, config, 'workspace');
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '')
    throw new OpenClawConfigError(file, '"agents.defaults.workspace" is not a non-empty string');
  return value;
}

/** `agents.defaults.bootstrapMaxChars`, when configured. */
export function configuredBootstrapMaxChars(file: string, config: JsonObject): number | undefined {
  const value = agentDefault(file, config, 'bootstrapMaxChars');
  if (value === undefined) return undefined;
  if (typeof value !== 'number')
    throw new OpenClawConfigError(file, '"agents.defaults.bootstrapMaxChars" is not a number');
  return value;
}

/** Translate one MCP server to an `mcp.servers.<id>` entry; credentials become `${VAR}` refs. */
export function toOpenClawMcp(server: McpServer): JsonObject {
  const entry: JsonObject = { transport: server.transport };
  if (server.transport === 'stdio') {
    if (server.command !== undefined) entry.command = toEnvRefs(server.command);
    if (server.args) entry.args = server.args.map(toEnvRefs);
    if (server.env)
      entry.env = Object.fromEntries(Object.entries(server.env).map(([k, v]) => [k, toEnvRefs(v)]));
  } else if (server.url !== undefined) {
    entry.url = toEnvRefs(server.url);
  }
  const ref = server.auth.credentialRef;
  if (ref !== undefined && server.auth.type === 'bearer')
    entry.headers = { Authorization: `Bearer \${${envName(ref)}}` };
  if (ref !== undefined && server.auth.type === 'header' && server.auth.headerName)
    entry.headers = { [server.auth.headerName]: `\${${envName(ref)}}` };
  if (server.auth.type === 'oauth2') entry.auth = 'oauth';
  const include = server.tools.include;
  if (include !== 'all' && include.length > 0) entry.toolFilter = { include };
  // OpenClaw's toolFilter.include requires >= 1 entry; an empty allowlist means "no tools".
  if (include !== 'all' && include.length === 0) entry.enabled = false;
  return entry;
}

/** Credential refs an installed MCP server entry references (auth + any placeholder). */
export function mcpCredentialRefs(server: McpServer): string[] {
  const strings = [
    server.command ?? '',
    server.url ?? '',
    ...(server.args ?? []),
    ...Object.values(server.env ?? {}),
  ];
  const refs = strings.flatMap(credentialRefsIn);
  if (
    server.auth.credentialRef !== undefined &&
    server.auth.type !== 'oauth2' &&
    server.auth.type !== 'none'
  )
    refs.push(server.auth.credentialRef);
  return [...new Set(refs)];
}

type MappedKind = 'telegram' | 'discord';

/** The channels.<kind> field that holds the bot token, for kinds Uniqent can map. */
const CHANNEL_TOKEN_FIELD: Record<MappedKind, string> = {
  telegram: 'botToken',
  discord: 'token',
};

/** Why a channel kind is not mapped into openclaw.json. */
const CHANNEL_UNMAPPED_REASON: Record<Exclude<ChannelKind, MappedKind>, string> = {
  slack:
    'OpenClaw Slack needs an app token + mode alongside the bot token; configure channels.slack manually (the bot token is stored in .env)',
  whatsapp: 'OpenClaw WhatsApp pairs by QR login, not a token; run the OpenClaw WhatsApp setup',
  sms: 'OpenClaw SMS (Twilio) needs account SID + phone number settings; configure channels.sms manually',
  email: 'OpenClaw has no built-in email channel',
  webhook: 'OpenClaw has no generic webhook channel (see hooks.* for inbound webhooks)',
};

function isMappedKind(kind: ChannelKind): kind is MappedKind {
  return kind === 'telegram' || kind === 'discord';
}

export interface ChannelMapping {
  channel: Channel;
  /** The `channels.<kind>` fields to set, when mappable. */
  fields?: JsonObject;
  /** Why it is not mapped, when not. */
  reason?: string;
}

/** Decide, per bundle channel, whether and how it maps into `channels.<kind>`. */
export function mapChannels(channels: Channel[]): ChannelMapping[] {
  const seen = new Set<ChannelKind>();
  return channels.map((channel) => {
    if (!isMappedKind(channel.kind))
      return { channel, reason: CHANNEL_UNMAPPED_REASON[channel.kind] };
    const field = CHANNEL_TOKEN_FIELD[channel.kind];
    if (seen.has(channel.kind))
      return {
        channel,
        reason: `OpenClaw holds one channels.${channel.kind} block; an earlier ${channel.kind} channel was mapped`,
      };
    if (channel.credentialRef === undefined)
      return { channel, reason: `no credentialRef for the ${channel.kind} bot token` };
    seen.add(channel.kind);
    return { channel, fields: { enabled: true, [field]: `\${${envName(channel.credentialRef)}}` } };
  });
}

/**
 * Merge Uniqent's entries into an existing config: `mcp.servers.<id>` entries are replaced whole,
 * `channels.<kind>` blocks get only the mapped fields set; every other key is preserved as-is.
 */
export function mergeConfig(
  file: string,
  existing: JsonObject,
  servers: Record<string, JsonObject>,
  channels: Record<string, JsonObject>,
): JsonObject {
  const out: JsonObject = { ...existing };
  if (Object.keys(servers).length > 0) {
    const mcp = objectAt(file, existing, 'mcp', 'mcp') ?? {};
    const current = objectAt(file, mcp, 'servers', 'mcp.servers') ?? {};
    out.mcp = { ...mcp, servers: { ...current, ...servers } };
  }
  if (Object.keys(channels).length > 0) {
    const current = objectAt(file, existing, 'channels', 'channels') ?? {};
    const merged: JsonObject = { ...current };
    for (const [kind, fields] of Object.entries(channels)) {
      merged[kind] = { ...(objectAt(file, current, kind, `channels.${kind}`) ?? {}), ...fields };
    }
    out.channels = merged;
  }
  return out;
}

/** Serialize the merged config (plain JSON is valid JSON5). */
export function serializeConfig(config: JsonObject): string {
  return JSON.stringify(config, null, 2) + '\n';
}
