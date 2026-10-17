import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isLikelySecretValue } from '@uniqent/core';
import type { Bundle } from '@uniqent/core';
import { Brain } from '@uniqent/builder';
import { readManagedSection, stripManagedSection } from './agents-md.js';
import { McpConfigParseError, parseMcpJson } from './mcp.js';

async function readIfExists(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, 'utf8') : undefined;
}

/** A stable credential-ref slug from an MCP server id (e.g. "com.x/gh" → "com-x-gh"). */
function slugFor(id: string): string {
  const slug = id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'mcp';
}

/** A stable credential ref id from an MCP server id (e.g. "com.x/gh" → "com-x-gh_token"). */
function credRefFor(id: string): string {
  return `${slugFor(id)}_token`;
}

/** A stable credential ref id for a stdio env var (e.g. "fs", "API_KEY" → "fs_api_key"). */
function envCredRefFor(id: string, key: string): string {
  return `${slugFor(id)}_${key.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

function optionalString(file: string, id: string, key: string, value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string')
    throw new McpConfigParseError(file, `"mcpServers.${id}.${key}" is not a string`);
  return value;
}

function optionalStringArray(
  file: string,
  id: string,
  key: string,
  value: unknown,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))
    throw new McpConfigParseError(file, `"mcpServers.${id}.${key}" is not an array of strings`);
  return value as string[];
}

function optionalStringRecord(
  file: string,
  id: string,
  key: string,
  value: unknown,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const ok =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string');
  if (!ok)
    throw new McpConfigParseError(file, `"mcpServers.${id}.${key}" is not a string→string map`);
  return value as Record<string, string>;
}

/**
 * The persona Claude Code actually loads: our managed AGENTS.md section when present, else the
 * user's own CLAUDE.md (minus our import section), else a plain AGENTS.md.
 */
async function capturePersona(root: string): Promise<string | undefined> {
  const agentsPath = join(root, 'AGENTS.md');
  const agents = await readIfExists(agentsPath);
  const managed = agents === undefined ? undefined : readManagedSection(agentsPath, agents);
  if (managed !== undefined) return managed;
  const claudePath = join(root, 'CLAUDE.md');
  const claude = await readIfExists(claudePath);
  const ownClaude = claude === undefined ? '' : stripManagedSection(claudePath, claude).trim();
  if (ownClaude) return ownClaude;
  return agents;
}

/** Capture an existing Claude Code project back into a canonical bundle (never a secret value). */
export async function exportClaudeCode(root: string): Promise<Bundle> {
  const brain = Brain.create({
    name: 'captured-agent',
    displayName: 'Captured Agent',
    version: '0.1.0',
    description: 'Captured from a Claude Code project.',
    author: { name: 'unknown' },
    license: 'CC0-1.0',
    tags: [],
  });

  const persona = await capturePersona(root);
  if (persona !== undefined) brain.setPersona(persona);

  const skillsDir = join(root, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    for (const name of await readdir(skillsDir)) {
      const md = await readIfExists(join(skillsDir, name, 'SKILL.md'));
      if (md !== undefined) brain.addSkill(name, md);
    }
  }

  const mcpPath = join(root, '.mcp.json');
  const mcpText = await readIfExists(mcpPath);
  const servers = mcpText === undefined ? {} : parseMcpJson(mcpPath, mcpText).servers;
  for (const [id, e] of Object.entries(servers)) {
    const command = optionalString(mcpPath, id, 'command', e.command);
    if (command !== undefined) {
      // stdio: keep literal env values; replace secret-looking ones with a credential REQUIREMENT.
      const rawEnv = optionalStringRecord(mcpPath, id, 'env', e.env);
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(rawEnv ?? {})) {
        if (!isLikelySecretValue(v)) {
          env[k] = v;
          continue;
        }
        const ref = envCredRefFor(id, k);
        env[k] = `\${credentialRef:${ref}}`;
        brain.addCredential({
          ref,
          label: `${id} ${k}`,
          type: 'envVar',
          consumedBy: [`mcp:${id}`],
          required: true,
          help: 'Re-supplied locally at install; captured from the source agent without its value.',
        });
      }
      brain.addMcpServer({
        id,
        transport: 'stdio',
        command,
        args: optionalStringArray(mcpPath, id, 'args', e.args),
        env: rawEnv === undefined ? undefined : env,
        auth: { type: 'none' },
        tools: { include: 'all' },
      });
      continue;
    }
    // http/sse: recover the credential REQUIREMENT from any auth header — never its value —
    // so the captured brain stays functional + shareable (and the secret-scan stays clean).
    const headers = optionalStringRecord(mcpPath, id, 'headers', e.headers) ?? {};
    const authzKey = Object.keys(headers).find((h) => h.toLowerCase() === 'authorization');
    const otherKey = Object.keys(headers).find((h) => h.toLowerCase() !== 'authorization');
    const ref = credRefFor(id);
    let auth: Record<string, unknown> = { type: 'none' };
    if (authzKey && /^Bearer\s/i.test(headers[authzKey] ?? '')) {
      auth = { type: 'bearer', credentialRef: ref };
    } else if (otherKey) {
      auth = { type: 'header', headerName: otherKey, credentialRef: ref };
    }
    brain.addMcpServer({
      id,
      transport: optionalString(mcpPath, id, 'type', e.type) === 'sse' ? 'sse' : 'streamable-http',
      url: optionalString(mcpPath, id, 'url', e.url),
      auth,
      tools: { include: 'all' },
    });
    if (auth.type !== 'none') {
      brain.addCredential({
        ref,
        label: `${id} credential`,
        type: auth.type === 'bearer' ? 'bearer' : 'header',
        consumedBy: [`mcp:${id}`],
        required: true,
        help: 'Re-supplied locally at install; captured from the source agent without its value.',
      });
    }
  }

  return brain.toBundle();
}
