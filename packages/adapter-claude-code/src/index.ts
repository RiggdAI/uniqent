import { chmod, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Bundle } from '@uniqent/core';
import type { McpServer } from '@uniqent/spec';
import { requiredCredentialRefs, resolveInside } from '@uniqent/adapter-sdk';
import type {
  Adapter,
  DetectResult,
  ExportOptions,
  InstallOptions,
  InstallPlan,
  InstallResult,
  Lossiness,
  PlanWrite,
  ResolvedCredentials,
} from '@uniqent/adapter-sdk';
import { describeAgentsBody, renderAgentsBody, upsertManagedSection } from './agents-md.js';
import { exportClaudeCode } from './export.js';
import {
  mcpEntryShape,
  parseMcpJson,
  placeholderCredentials,
  scopedCredentials,
  toClaudeMcpEntry,
} from './mcp.js';
import type { McpJsonFile } from './mcp.js';

const AGENTS_MD = 'AGENTS.md';
const CLAUDE_MD = 'CLAUDE.md';
const MCP_JSON = '.mcp.json';
const SKILLS_DIR = join('.claude', 'skills');
/** Claude Code reads AGENTS.md only when no CLAUDE.md exists, so a CLAUDE.md must import it. */
const AGENTS_IMPORT = '@AGENTS.md';

async function readIfExists(path: string): Promise<string | undefined> {
  return existsSync(path) ? readFile(path, 'utf8') : undefined;
}

interface SkillTarget {
  bundlePath: string;
  /** Root-relative, forward-slash path for plans and results. */
  rel: string;
  target: string;
}

/** Bundle skill files, each resolved inside `<root>/.claude/skills` (throws PathEscapeError). */
function skillTargets(bundle: Bundle, root: string): SkillTarget[] {
  return bundle
    .list()
    .filter((p) => p.startsWith('skills/'))
    .map((bundlePath) => {
      const target = resolveInside(join(root, SKILLS_DIR), bundlePath.slice('skills/'.length));
      return { bundlePath, rel: relative(root, target).split(sep).join('/'), target };
    });
}

async function readMcpJson(root: string): Promise<McpJsonFile | undefined> {
  const path = resolveInside(root, MCP_JSON);
  const text = await readIfExists(path);
  return text === undefined ? undefined : parseMcpJson(path, text);
}

/** Incoming servers whose id already exists in `.mcp.json` with a different command/url/shape. */
function replacedServerIds(servers: McpServer[], existing: McpJsonFile | undefined): string[] {
  if (!existing) return [];
  return servers
    .filter((s) => {
      const current = existing.servers[s.id];
      if (current === undefined) return false;
      const incoming = toClaudeMcpEntry(s, placeholderCredentials(s));
      return mcpEntryShape(current) !== mcpEntryShape(incoming);
    })
    .map((s) => s.id);
}

function computeLossiness(bundle: Bundle, replaced: string[]): Lossiness[] {
  const lossiness: Lossiness[] = [];
  const channels = bundle.channels();
  if (channels.length > 0)
    lossiness.push({
      component: 'channels',
      issue: `Claude Code has no channel concept; ${channels.map((c) => c.id).join(', ')} and their config dropped.`,
      action: 'dropped',
    });
  if (bundle.tasks().length > 0)
    lossiness.push({
      component: 'tasks',
      issue: 'Claude Code has no automation concept; dropped.',
      action: 'dropped',
    });
  if (bundle.tools().length > 0)
    lossiness.push({
      component: 'tools',
      issue: 'native tool enablement differs; dropped.',
      action: 'dropped',
    });
  if (bundle.runtime() !== undefined)
    lossiness.push({
      component: 'runtime',
      issue:
        'setup/runtime.json (model, autonomy, toolAllowlist, defaults) is not mapped into Claude Code settings; dropped.',
      action: 'dropped',
    });
  const profile = bundle.memoryProfile();
  if (bundle.memoryFacts().length > 0 || (profile && Object.keys(profile).length > 0))
    lossiness.push({
      component: 'memory',
      issue: 'facts + profile folded into AGENTS.md as text; structure not preserved.',
      action: 'transformed',
    });
  const episodic = bundle.memoryEpisodic().length;
  if (episodic > 0)
    lossiness.push({
      component: 'memory (episodic)',
      issue: `${episodic} episodic memory item(s) are not installed; Claude Code has no episodic store.`,
      action: 'dropped',
    });
  for (const s of bundle.mcpServers()) {
    if (s.tools.include === 'all') continue;
    lossiness.push({
      component: `mcp:${s.id} tools`,
      issue: `.mcp.json has no per-server tool filter; allowlist [${s.tools.include.join(', ')}] is not enforced — every tool the server exposes is available.`,
      action: 'dropped',
    });
  }
  for (const id of replaced)
    lossiness.push({
      component: `mcp:${id}`,
      issue: `replaces your existing, different "${id}" entry in .mcp.json.`,
      action: 'transformed',
    });
  return lossiness;
}

/**
 * Dry-analyze an install into `root`: validates every path, credential scope, and the existing
 * `.mcp.json` up front (throwing before anything is written) and reports modifications of
 * existing files as such.
 */
async function computePlan(bundle: Bundle, root: string): Promise<InstallPlan> {
  const writes: PlanWrite[] = skillTargets(bundle, root).map((s) => ({
    path: s.rel,
    summary: 'skill file',
  }));

  const agentsParts = describeAgentsBody(bundle);
  if (agentsParts) {
    const exists = existsSync(resolveInside(root, AGENTS_MD));
    writes.push({
      path: AGENTS_MD,
      summary: exists
        ? `modify existing: replace the uniqent-managed section (${agentsParts}); content outside it is preserved`
        : `create: ${agentsParts}`,
    });
    if (existsSync(resolveInside(root, CLAUDE_MD)))
      writes.push({
        path: CLAUDE_MD,
        summary: `modify existing: add a uniqent-managed "${AGENTS_IMPORT}" import (Claude Code ignores AGENTS.md when CLAUDE.md exists); content outside it is preserved`,
      });
  }

  const servers = bundle.mcpServers();
  const requiresCredentials = requiredCredentialRefs(bundle, ['mcp']);
  let replaced: string[] = [];
  if (servers.length > 0) {
    for (const s of servers) scopedCredentials(bundle, s, {});
    const existing = await readMcpJson(root);
    replaced = replacedServerIds(servers, existing);
    const merge = existing
      ? `modify existing: merge ${servers.length} MCP server(s)` +
        (replaced.length > 0 ? `, replacing your entries: ${replaced.join(', ')}` : '')
      : `create: ${servers.length} MCP server(s)`;
    const secrets =
      requiresCredentials.length > 0
        ? '; will contain resolved credentials (mode 0600 — do not commit)'
        : '';
    writes.push({ path: MCP_JSON, summary: merge + secrets });
  }

  return {
    writes,
    mcpRegistrations: servers.map((s) => s.id),
    channelRegistrations: [],
    lossiness: computeLossiness(bundle, replaced),
    requiresCredentials,
  };
}

export const claudeCodeAdapter: Adapter = {
  id: 'claude-code',
  displayName: 'Claude Code',

  async detect({ root }): Promise<DetectResult> {
    const r = root ?? process.cwd();
    const present = existsSync(join(r, '.claude')) || existsSync(join(r, MCP_JSON));
    return { present, configRoot: join(r, '.claude') };
  },

  async plan(bundle: Bundle, { root }: InstallOptions): Promise<InstallPlan> {
    return computePlan(bundle, root);
  },

  async apply(
    bundle: Bundle,
    _plan: InstallPlan,
    resolved: ResolvedCredentials,
    { root }: InstallOptions,
  ): Promise<InstallResult> {
    // Re-plan against the current state: validates everything before the first write.
    const plan = await computePlan(bundle, root);
    await mkdir(root, { recursive: true });
    const written: string[] = [];
    const notes: string[] = [];

    for (const skill of skillTargets(bundle, root)) {
      const bytes = bundle.get(skill.bundlePath);
      if (!bytes) continue;
      await mkdir(dirname(skill.target), { recursive: true });
      await writeFile(skill.target, bytes);
      written.push(skill.rel);
    }

    const body = renderAgentsBody(bundle);
    if (body !== undefined) {
      const agentsPath = resolveInside(root, AGENTS_MD);
      const agents = await readIfExists(agentsPath);
      await writeFile(agentsPath, upsertManagedSection(agentsPath, agents, body));
      written.push(AGENTS_MD);
      const claudePath = resolveInside(root, CLAUDE_MD);
      const claude = await readIfExists(claudePath);
      if (claude !== undefined) {
        await writeFile(claudePath, upsertManagedSection(claudePath, claude, AGENTS_IMPORT));
        written.push(CLAUDE_MD);
        notes.push(
          `CLAUDE.md exists, so Claude Code would ignore AGENTS.md; added a uniqent-managed "${AGENTS_IMPORT}" import to CLAUDE.md`,
        );
      }
    }

    const servers = bundle.mcpServers();
    if (servers.length > 0) {
      const mcpPath = resolveInside(root, MCP_JSON);
      const existing = await readMcpJson(root);
      const entries = servers.map((s) => ({
        server: s,
        entry: toClaudeMcpEntry(s, scopedCredentials(bundle, s, resolved)),
      }));
      const inlinesSecrets = entries.some(
        ({ server, entry }) =>
          JSON.stringify(entry) !== JSON.stringify(toClaudeMcpEntry(server, {})),
      );
      const mcpServers: Record<string, unknown> = {
        ...(existing?.servers ?? {}),
        ...Object.fromEntries(entries.map(({ server, entry }) => [server.id, entry])),
      };
      await writeFile(
        mcpPath,
        JSON.stringify({ ...(existing?.doc ?? {}), mcpServers }, null, 2) + '\n',
        { mode: inlinesSecrets ? 0o600 : 0o666 },
      );
      written.push(MCP_JSON);
      if (inlinesSecrets) {
        // writeFile's mode only applies on creation; tighten a pre-existing file too.
        await chmod(mcpPath, 0o600);
        notes.push(
          '.mcp.json contains resolved credentials (written with mode 0600) — do not commit it; add it to .gitignore',
        );
      }
    }

    for (const l of plan.lossiness) {
      notes.push(`${l.action}: ${l.component} — ${l.issue}`);
    }
    return { written, notes };
  },

  async export({ root }: ExportOptions): Promise<Bundle> {
    return exportClaudeCode(root);
  },
};

export { toClaudeMcpEntry };
export { McpConfigParseError, CredentialScopeError } from './mcp.js';
export { ManagedSectionError, MANAGED_BEGIN, MANAGED_END } from './agents-md.js';
