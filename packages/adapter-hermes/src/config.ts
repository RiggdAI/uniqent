import { Document, isMap, isScalar, parseDocument } from 'yaml';
import { MEMORY_MAX, USER_MAX } from './memory.js';
import type { HermesMcpEntry } from './mcp.js';

/** $HERMES_HOME/config.yaml is unreadable as a Hermes config (bad YAML or wrong shape). */
export class HermesConfigError extends Error {
  constructor(message: string) {
    super(`config.yaml: ${message}`);
    this.name = 'HermesConfigError';
  }
}

/** Parse config.yaml text (undefined = file absent) into a comment-preserving yaml Document. */
function parseConfig(raw: string | undefined): Document {
  const doc = parseDocument(raw ?? '');
  if (doc.errors.length > 0)
    throw new HermesConfigError(`invalid YAML: ${doc.errors.map((e) => e.message).join('; ')}`);
  if (doc.contents !== null && !isMap(doc.contents))
    throw new HermesConfigError('the top level must be a mapping');
  return doc;
}

function readLimit(doc: Document, key: string, fallback: number): number {
  const value: unknown = doc.getIn(['memory', key]);
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    throw new HermesConfigError(
      `memory.${key} must be a positive integer, got ${JSON.stringify(value)}`,
    );
  return value;
}

/**
 * Memory char budgets Hermes will enforce: config.yaml `memory.memory_char_limit` /
 * `memory.user_char_limit` when set, else Hermes' defaults (agent/agent_init.py).
 */
export function memoryLimits(raw: string | undefined): { memory: number; user: number } {
  const doc = parseConfig(raw);
  return {
    memory: readLimit(doc, 'memory_char_limit', MEMORY_MAX),
    user: readLimit(doc, 'user_char_limit', USER_MAX),
  };
}

/**
 * Set `mcp_servers.<id>` for each entry in config.yaml text and return the new text. Every other
 * key, server and comment in the file survives; re-merging the same entries is byte-identical.
 */
export function mergeMcpServers(
  raw: string | undefined,
  entries: Array<[string, HermesMcpEntry]>,
): string {
  const doc = parseConfig(raw);
  const current = doc.get('mcp_servers', true);
  if (isScalar(current) && current.value === null) doc.set('mcp_servers', doc.createNode({}));
  else if (current !== undefined && !isMap(current))
    throw new HermesConfigError('mcp_servers must be a mapping of server name → config');
  for (const [id, entry] of entries) doc.setIn(['mcp_servers', id], doc.createNode(entry));
  return doc.toString();
}

/** The raw `mcp_servers` mapping from config.yaml text (empty when absent). */
export function readMcpServers(raw: string | undefined): Record<string, unknown> {
  const servers: unknown = parseConfig(raw).toJS()?.mcp_servers;
  if (servers === undefined || servers === null) return {};
  if (typeof servers !== 'object' || Array.isArray(servers))
    throw new HermesConfigError('mcp_servers must be a mapping of server name → config');
  return servers as Record<string, unknown>;
}
