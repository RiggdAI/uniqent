import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Bundle } from '@uniqent/core';
import { Brain } from '@uniqent/builder';
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
import { buildMemoryMd, buildUserMd, envName, MEMORY_MAX, USER_MAX } from './memory.js';

/** Credential refs consumed by an MCP server or a channel (both install into Hermes). */
function requiredCreds(bundle: Bundle): string[] {
  const refs = new Set<string>();
  for (const s of bundle.mcpServers()) if (s.auth.credentialRef) refs.add(s.auth.credentialRef);
  for (const c of bundle.channels()) if (c.credentialRef) refs.add(c.credentialRef);
  return [...refs];
}

function computePlan(bundle: Bundle): InstallPlan {
  const writes = [];
  if (bundle.persona() !== undefined)
    writes.push({ path: 'SOUL.md', summary: 'identity / system prompt' });

  const facts = bundle.memoryFacts();
  const mem = buildMemoryMd(facts);
  const lossiness: Lossiness[] = [];
  if (facts.length > 0)
    writes.push({ path: 'MEMORY.md', summary: `${mem.included} memory fact(s)` });
  if (mem.dropped > 0)
    lossiness.push({
      component: 'memory',
      issue: `${mem.dropped} of ${facts.length} facts dropped to fit MEMORY.md (~${MEMORY_MAX} chars); consider an external memory provider.`,
      action: 'truncated',
    });

  const profile = bundle.memoryProfile();
  if (profile) {
    writes.push({ path: 'USER.md', summary: 'user profile' });
    if (buildUserMd(profile).truncated)
      lossiness.push({
        component: 'memory profile',
        issue: `USER.md truncated to ~${USER_MAX} chars.`,
        action: 'truncated',
      });
  }

  for (const path of bundle.list()) {
    if (path.startsWith('skills/')) writes.push({ path, summary: 'skill file' });
  }

  const servers = bundle.mcpServers();
  const channels = bundle.channels();
  const tasks = bundle.tasks();
  if (servers.length || channels.length || tasks.length)
    writes.push({ path: 'hermes.json', summary: 'mcp + channels + tasks' });

  const creds = requiredCreds(bundle);
  if (creds.length) writes.push({ path: '.env', summary: 'resolved credentials' });

  if (bundle.tools().length > 0)
    lossiness.push({
      component: 'tools',
      issue: 'Hermes native tool model differs; dropped.',
      action: 'dropped',
    });

  return {
    writes,
    mcpRegistrations: servers.map((s) => s.id),
    channelRegistrations: channels.map((c) => c.id),
    lossiness,
    requiresCredentials: creds,
  };
}

interface HermesConfig {
  identity?: string;
  memory?: { facts?: string; user?: string };
  mcpServers: Record<string, Record<string, unknown>>;
  channels: Array<Record<string, unknown>>;
  tasks: unknown[];
}

export const hermesAdapter: Adapter = {
  id: 'hermes',
  displayName: 'Hermes',

  async detect({ root }): Promise<DetectResult> {
    return { present: true, configRoot: root ?? process.cwd() };
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
    const notes: string[] = [];
    const write = async (rel: string, data: string | Uint8Array) => {
      const target = join(root, rel);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      written.push(rel);
    };

    const persona = bundle.persona();
    if (persona !== undefined) {
      const policies = bundle.policies();
      await write(
        'SOUL.md',
        policies ? `${persona.trim()}\n\n## Policies\n\n${policies.trim()}\n` : persona,
      );
    }

    const facts = bundle.memoryFacts();
    if (facts.length > 0) await write('MEMORY.md', buildMemoryMd(facts).content);
    const profile = bundle.memoryProfile();
    if (profile) await write('USER.md', buildUserMd(profile).content);

    for (const path of bundle.list()) {
      if (!path.startsWith('skills/')) continue;
      const bytes = bundle.get(path);
      if (bytes) await write(path, bytes);
    }

    const servers = bundle.mcpServers();
    const channels = bundle.channels();
    const tasks = bundle.tasks();
    if (servers.length || channels.length || tasks.length) {
      const config: HermesConfig = { identity: 'SOUL.md', mcpServers: {}, channels: [], tasks };
      if (facts.length > 0 || profile) {
        config.memory = {};
        if (facts.length > 0) config.memory.facts = 'MEMORY.md';
        if (profile) config.memory.user = 'USER.md';
      }
      for (const s of servers) {
        const entry: Record<string, unknown> = { transport: s.transport };
        if (s.transport === 'stdio') {
          entry.command = s.command;
          if (s.args) entry.args = s.args;
          if (s.env) entry.env = s.env;
        } else {
          entry.url = s.url;
        }
        if (s.auth.credentialRef) {
          const env = envName(s.auth.credentialRef);
          if (s.auth.type === 'bearer') entry.headers = { Authorization: `Bearer \${${env}}` };
          else if (s.auth.type === 'header' && s.auth.headerName)
            entry.headers = { [s.auth.headerName]: `\${${env}}` };
        }
        config.mcpServers[s.id] = entry;
      }
      for (const c of channels) {
        const ch: Record<string, unknown> = { id: c.id, kind: c.kind };
        if (c.credentialRef) ch.token = `\${${envName(c.credentialRef)}}`;
        config.channels.push(ch);
      }
      await write('hermes.json', JSON.stringify(config, null, 2) + '\n');
    }

    const creds = requiredCreds(bundle);
    if (creds.length) {
      const env = creds.map((ref) => `${envName(ref)}=${resolved[ref] ?? ''}`).join('\n') + '\n';
      await write('.env', env);
    }

    for (const l of computePlan(bundle).lossiness)
      notes.push(`${l.action}: ${l.component} — ${l.issue}`);
    return { written, notes };
  },

  async export({ root }: ExportOptions): Promise<Bundle> {
    const brain = Brain.create({
      name: 'captured-hermes-agent',
      displayName: 'Captured Hermes Agent',
      version: '0.1.0',
      description: 'Captured from a Hermes setup.',
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
      const md = await readFile(join(root, 'MEMORY.md'), 'utf8');
      let i = 0;
      for (const line of md.split('\n')) {
        const m = /^-\s+(.*)$/.exec(line.trim());
        if (m && m[1]) {
          brain.addMemory({
            id: `m${++i}`,
            kind: 'fact',
            text: m[1],
            createdAt: '1970-01-01T00:00:00.000Z',
          });
        }
      }
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
