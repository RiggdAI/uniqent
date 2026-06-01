import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Bundle } from '@uniqent/core';
import { resolvePlaceholders } from '@uniqent/core';
import { Brain, stripMemoryMarkup } from '@uniqent/builder';
import type { McpServer } from '@uniqent/spec';
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

function requiredCreds(bundle: Bundle): string[] {
  const refs = new Set<string>();
  for (const s of bundle.mcpServers()) if (s.auth.credentialRef) refs.add(s.auth.credentialRef);
  for (const c of bundle.channels()) if (c.credentialRef) refs.add(c.credentialRef);
  return [...refs];
}

function computePlan(bundle: Bundle): InstallPlan {
  const writes = [];
  if (bundle.persona() !== undefined) writes.push({ path: 'SOUL.md', summary: 'identity / soul' });
  if (
    bundle.memoryFacts().length > 0 ||
    bundle.memoryEpisodic().length > 0 ||
    bundle.memoryProfile()
  ) {
    writes.push({ path: 'MEMORY.md', summary: 'memory + user profile' });
  }
  for (const path of bundle.list()) {
    if (path.startsWith('skills/')) writes.push({ path, summary: 'skill file' });
  }
  const servers = bundle.mcpServers();
  const channels = bundle.channels();
  const tasks = bundle.tasks();
  if (servers.length || channels.length || tasks.length) {
    writes.push({ path: 'openclaw.json', summary: 'mcp + channels + tasks' });
  }

  const lossiness: Lossiness[] = [];
  if (bundle.tools().length > 0) {
    lossiness.push({
      component: 'tools',
      issue: 'OpenClaw native tool model differs; dropped.',
      action: 'dropped',
    });
  }

  return {
    writes,
    mcpRegistrations: servers.map((s) => s.id),
    channelRegistrations: channels.map((c) => c.id),
    lossiness,
    requiresCredentials: requiredCreds(bundle),
  };
}

function buildSoulMd(bundle: Bundle): string {
  const persona = bundle.persona() ?? '';
  const policies = bundle.policies();
  return policies ? `${persona.trim()}\n\n## Policies\n\n${policies.trim()}\n` : persona;
}

function buildMemoryMd(bundle: Bundle): string {
  const parts: string[] = ['# Memory', ''];
  for (const f of bundle.memoryFacts()) parts.push(`- ${stripMemoryMarkup(f.text)}`);
  const profile = bundle.memoryProfile();
  if (profile && Object.keys(profile).length > 0) {
    parts.push('', '## User profile', '');
    for (const [k, v] of Object.entries(profile)) {
      parts.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  return parts.join('\n') + '\n';
}

/** Translate an MCP server to OpenClaw's openclaw.json form, inlining resolved credentials. */
function toOpenClawMcp(server: McpServer, resolved: ResolvedCredentials): Record<string, unknown> {
  const entry: Record<string, unknown> = { transport: server.transport };
  if (server.transport === 'stdio') {
    entry.command = server.command;
    if (server.args) entry.args = server.args;
    if (server.env) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(server.env)) env[k] = resolvePlaceholders(v, resolved);
      entry.env = env;
    }
  } else {
    entry.url = server.url;
    const value = server.auth.credentialRef ? resolved[server.auth.credentialRef] : undefined;
    if (value) {
      if (server.auth.type === 'bearer') entry.headers = { Authorization: `Bearer ${value}` };
      else if (server.auth.type === 'header' && server.auth.headerName)
        entry.headers = { [server.auth.headerName]: value };
    }
  }
  return entry;
}

export const openClawAdapter: Adapter = {
  id: 'openclaw',
  displayName: 'OpenClaw',

  async detect({ root }): Promise<DetectResult> {
    return { present: true, configRoot: root ?? process.env.OPENCLAW_STATE_DIR ?? process.cwd() };
  },

  async plan(bundle: Bundle): Promise<InstallPlan> {
    return computePlan(bundle);
  },

  async apply(
    bundle: Bundle,
    _plan: InstallPlan,
    resolved: ResolvedCredentials,
    { root }: InstallOptions,
  ): Promise<InstallResult> {
    const written: string[] = [];
    const write = async (rel: string, data: string | Uint8Array) => {
      const target = join(root, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      written.push(rel);
    };

    if (bundle.persona() !== undefined) await write('SOUL.md', buildSoulMd(bundle));
    if (
      bundle.memoryFacts().length > 0 ||
      bundle.memoryEpisodic().length > 0 ||
      bundle.memoryProfile()
    ) {
      await write('MEMORY.md', buildMemoryMd(bundle));
    }
    for (const path of bundle.list()) {
      if (!path.startsWith('skills/')) continue;
      const bytes = bundle.get(path);
      if (bytes) await write(path, bytes);
    }

    const servers = bundle.mcpServers();
    const channels = bundle.channels();
    const tasks = bundle.tasks();
    if (servers.length || channels.length || tasks.length) {
      const config: Record<string, unknown> = { soul: 'SOUL.md', memory: 'MEMORY.md' };
      const mcpServers: Record<string, unknown> = {};
      for (const s of servers) mcpServers[s.id] = toOpenClawMcp(s, resolved);
      config.mcpServers = mcpServers;
      config.channels = channels.map((c) => {
        const ch: Record<string, unknown> = { id: c.id, kind: c.kind };
        const token = c.credentialRef ? resolved[c.credentialRef] : undefined;
        if (token) ch.token = token;
        return ch;
      });
      config.tasks = tasks;
      await write('openclaw.json', JSON.stringify(config, null, 2) + '\n');
    }

    const notes = computePlan(bundle).lossiness.map(
      (l) => `${l.action}: ${l.component} — ${l.issue}`,
    );
    return { written, notes };
  },

  async export({ root }: ExportOptions): Promise<Bundle> {
    const brain = Brain.create({
      name: 'captured-openclaw-agent',
      displayName: 'Captured OpenClaw Agent',
      version: '0.1.0',
      description: 'Captured from an OpenClaw setup.',
      author: { name: 'unknown' },
      license: 'CC0-1.0',
      tags: [],
    });
    try {
      brain.setPersona(await readFile(join(root, 'SOUL.md'), 'utf8'));
    } catch {
      /* none */
    }
    try {
      for (const name of await readdir(join(root, 'skills'))) {
        try {
          brain.addSkill(name, await readFile(join(root, 'skills', name, 'SKILL.md'), 'utf8'));
        } catch {
          /* not a skill */
        }
      }
    } catch {
      /* none */
    }
    return brain.toBundle();
  },
};
