import type { Bundle } from '@uniqent/core/pure';
import type { McpServer } from '@uniqent/spec';
import {
  assertNoEnvReferences,
  confineRelative,
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
  type PlanWrite,
  type ReadFiles,
  type ResolvedCredentials,
  type TargetContext,
  type Translation,
} from '@uniqent/adapter-sdk/pure';
import { describeAgentsBody, renderAgentsBody, upsertManagedSection } from './agents-md.js';
import {
  mcpEntryShape,
  parseMcpJson,
  placeholderCredentials,
  scopedCredentials,
  serverCredentialRefs,
  toClaudeMcpEntry,
} from './mcp.js';
import type { McpJsonFile } from './mcp.js';

export const AGENTS_MD = 'AGENTS.md';
export const CLAUDE_MD = 'CLAUDE.md';
export const MCP_JSON = '.mcp.json';
export const SKILLS_DIR = '.claude/skills';
/** Claude Code reads AGENTS.md only when no CLAUDE.md exists, so a CLAUDE.md must import it. */
const AGENTS_IMPORT = '@AGENTS.md';

interface SkillTarget {
  bundlePath: string;
  /** Root-relative, forward-slash path for plans, results and writes. */
  path: string;
}

/** Bundle skill files, each confined to `<root>/.claude/skills` (throws PathEscapeError). */
function skillTargets(bundle: Bundle, root: string): SkillTarget[] {
  return bundle
    .list()
    .filter((p) => p.startsWith('skills/'))
    .map((bundlePath) => ({
      bundlePath,
      path: `${SKILLS_DIR}/${confineRelative(joinPath(root, SKILLS_DIR), bundlePath.slice('skills/'.length))}`,
    }));
}

/**
 * Files the install reads: the three project files it merges into, then the target of every
 * bundle skill file (a hostile skill path throws PathEscapeError here, before anything is read).
 */
export function inputs(bundle: Bundle, _read: ReadFiles, ctx: TargetContext): InputRequest {
  const files: FileRef[] = [
    ...[AGENTS_MD, CLAUDE_MD, MCP_JSON].map((path) => ({ root: ctx.root, path })),
    ...skillTargets(bundle, ctx.root).map((s) => ({ root: ctx.root, path: s.path })),
  ];
  return { files, finds: [] };
}

/** Bundle skill files that would replace an existing, different file (root-relative paths). */
function replacedSkillFiles(
  bundle: Bundle,
  skills: SkillTarget[],
  read: ReadFiles,
  root: string,
): string[] {
  return skills
    .filter((skill) => {
      const bytes = bundle.get(skill.bundlePath);
      const prior = read.get(joinPath(root, skill.path));
      return bytes !== undefined && prior !== undefined && !sameBytes(prior, bytes);
    })
    .map((skill) => skill.path);
}

function readMcpJson(read: ReadFiles, root: string): McpJsonFile | undefined {
  const text = readText(read, root, MCP_JSON);
  return text === undefined ? undefined : parseMcpJson(joinPath(root, MCP_JSON), text);
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

function computeLossiness(
  bundle: Bundle,
  replaced: string[],
  replacedSkills: string[],
): Lossiness[] {
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
  for (const rel of replacedSkills)
    lossiness.push({
      component: `skill ${rel}`,
      issue: 'replaces an existing, different skill file.',
      action: 'transformed',
    });
  return lossiness;
}

/**
 * Dry-analyze an install against the files `inputs()` read: validates every path, credential
 * scope, and the existing `.mcp.json` up front (throwing before anything is written) and reports
 * modifications of existing files as such.
 */
export function planInstall(bundle: Bundle, read: ReadFiles, ctx: TargetContext): InstallPlan {
  const { root } = ctx;
  assertNoEnvReferences(bundle);
  const skills = skillTargets(bundle, root);
  const writes: PlanWrite[] = skills.map((s) => ({
    path: s.path,
    summary: 'skill file',
  }));

  const agentsParts = describeAgentsBody(bundle);
  if (agentsParts) {
    const exists = read.has(joinPath(root, AGENTS_MD));
    writes.push({
      path: AGENTS_MD,
      summary: exists
        ? `modify existing: replace the uniqent-managed section (${agentsParts}); content outside it is preserved`
        : `create: ${agentsParts}`,
    });
    if (read.has(joinPath(root, CLAUDE_MD)))
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
    const existing = readMcpJson(read, root);
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
    lossiness: computeLossiness(bundle, replaced, replacedSkillFiles(bundle, skills, read, root)),
    requiresCredentials,
  };
}

const ENCODER = new TextEncoder();

/**
 * Every file the install writes, in order: skills, AGENTS.md, CLAUDE.md (import), then
 * `.mcp.json` (owner-only when it inlines a credential). Throws MissingCredentialError when an
 * MCP server's credential has no value in `resolved`.
 */
export function translate(
  bundle: Bundle,
  read: ReadFiles,
  resolved: ResolvedCredentials,
  ctx: TargetContext,
): Translation {
  const { root } = ctx;
  const plan = planInstall(bundle, read, ctx);
  // Resolve every MCP entry (throws on a missing credential) before producing any write.
  const servers = bundle.mcpServers();
  const entries = servers.map((s) => ({
    server: s,
    entry: toClaudeMcpEntry(s, scopedCredentials(bundle, s, resolved)),
  }));
  const writes: OutputWrite[] = [];
  const notes: string[] = [];
  const write = (path: string, bytes: Uint8Array, mode: OutputWrite['mode']) =>
    writes.push({ root, path, bytes, mode });

  for (const skill of skillTargets(bundle, root)) {
    const bytes = bundle.get(skill.bundlePath);
    if (!bytes) continue;
    write(skill.path, bytes, null);
  }

  const body = renderAgentsBody(bundle);
  if (body !== undefined) {
    const agents = readText(read, root, AGENTS_MD);
    write(
      AGENTS_MD,
      ENCODER.encode(upsertManagedSection(joinPath(root, AGENTS_MD), agents, body)),
      null,
    );
    const claude = readText(read, root, CLAUDE_MD);
    if (claude !== undefined) {
      write(
        CLAUDE_MD,
        ENCODER.encode(upsertManagedSection(joinPath(root, CLAUDE_MD), claude, AGENTS_IMPORT)),
        null,
      );
      notes.push(
        `CLAUDE.md exists, so Claude Code would ignore AGENTS.md; added a uniqent-managed "${AGENTS_IMPORT}" import to CLAUDE.md`,
      );
    }
  }

  if (servers.length > 0) {
    const existing = readMcpJson(read, root);
    const inlinesSecrets = servers.some((s) => serverCredentialRefs(s).length > 0);
    const mcpServers: Record<string, unknown> = {
      ...(existing?.servers ?? {}),
      ...Object.fromEntries(entries.map(({ server, entry }) => [server.id, entry])),
    };
    write(
      MCP_JSON,
      ENCODER.encode(JSON.stringify({ ...(existing?.doc ?? {}), mcpServers }, null, 2) + '\n'),
      // Owner-only also tightens a pre-existing file; otherwise its mode is kept.
      inlinesSecrets ? OWNER_ONLY : null,
    );
    if (inlinesSecrets)
      notes.push(
        '.mcp.json contains resolved credentials (written with mode 0600) — do not commit it; add it to .gitignore',
      );
  }

  for (const l of plan.lossiness) {
    notes.push(`${l.action}: ${l.component} — ${l.issue}`);
  }
  return { plan, writes, notes };
}
