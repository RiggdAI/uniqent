import {
  Brain,
  MCP_CATALOG,
  SKILL_CATALOG,
  CHANNEL_CATALOG,
  searchMcpHubs,
  searchSkillHubs,
  defaultMcpSources,
  defaultSkillSources,
  installMcpHubResult,
} from '@uniqent/builder';
import type { BrainMeta, McpHubResult, SkillHubResult, HubSearch } from '@uniqent/builder';
import { validateBundle, generateKeypair, sign, pack, verify } from '@uniqent/core';
import type { ValidationResult, Keypair } from '@uniqent/core';
import type { Manifest } from '@uniqent/spec';
import type {
  Adapter,
  InstallPlan,
  InstallResult,
  ResolvedCredentials,
} from '@uniqent/adapter-sdk';
import { claudeCodeAdapter } from '@uniqent/adapter-claude-code';
import { hermesAdapter } from '@uniqent/adapter-hermes';
import { openClawAdapter } from '@uniqent/adapter-openclaw';

const ADAPTERS: Record<string, Adapter> = {
  'claude-code': claudeCodeAdapter,
  hermes: hermesAdapter,
  openclaw: openClawAdapter,
};

const DEFAULT_META: BrainMeta = {
  name: 'my-brain',
  displayName: 'My Brain',
  version: '0.1.0',
  description: 'A portable agent brain.',
  author: { name: 'Anonymous' },
  license: 'CC0-1.0',
  tags: [],
};

/** Derive a skill name from a SKILL.md URL (…/<name>/SKILL.md or …/<name>.md). */
function skillNameFromUrl(url: string): string {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    let last = parts[parts.length - 1] ?? 'imported-skill';
    if (/^skill\.md$/i.test(last)) last = parts[parts.length - 2] ?? 'imported-skill';
    return last.replace(/\.md$/i, '') || 'imported-skill';
  } catch {
    return 'imported-skill';
  }
}

export interface CatalogView {
  mcp: Array<{
    id: string;
    name: string;
    description: string;
    transport: string;
    credential?: string;
  }>;
  skills: Array<{ name: string; description: string }>;
  channels: Array<{
    id: string;
    name: string;
    description: string;
    kind: string;
    credential?: string;
  }>;
  targets: string[];
}

export interface StudioState {
  manifest: Manifest;
  validation: ValidationResult;
}

export interface ExportResult {
  filename: string;
  bytesBase64: string;
  signed: boolean;
  verified: boolean;
  validation: ValidationResult;
}

/** Holds one in-memory Brain and exposes the operations Studio's UI needs. */
export class StudioSession {
  private brain: Brain;
  private keypair?: Keypair;
  private factCounter = 0;
  private taskCounter = 0;

  constructor() {
    this.brain = Brain.create({ ...DEFAULT_META });
  }

  reset(): void {
    this.brain = Brain.create({ ...DEFAULT_META });
    this.factCounter = 0;
    this.taskCounter = 0;
  }

  catalog(): CatalogView {
    return {
      mcp: MCP_CATALOG.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        transport: e.server.transport,
        credential: e.credential?.ref,
      })),
      skills: SKILL_CATALOG.map((e) => ({ name: e.name, description: e.description })),
      channels: CHANNEL_CATALOG.map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description,
        kind: e.channel.kind,
        credential: e.credential?.ref,
      })),
      targets: Object.keys(ADAPTERS),
    };
  }

  /** Dry-run plan for installing the current brain into a framework at `root`. */
  async installPlan(target: string, root: string): Promise<InstallPlan> {
    const adapter = ADAPTERS[target];
    if (!adapter) throw new Error(`unknown target: ${target}`);
    return adapter.plan(this.brain.toBundle(), { root });
  }

  /** Install the current brain into a framework at `root`, resolving credentials locally. */
  async install(
    target: string,
    root: string,
    resolved: ResolvedCredentials,
  ): Promise<InstallResult> {
    const adapter = ADAPTERS[target];
    if (!adapter) throw new Error(`unknown target: ${target}`);
    const bundle = this.brain.toBundle();
    const validation = validateBundle(bundle);
    if (!validation.ok) {
      throw new Error(
        `brain is invalid; fix it before installing: ${validation.errors.map((e) => e.message).join('; ')}`,
      );
    }
    const plan = await adapter.plan(bundle, { root });
    return adapter.apply(bundle, plan, resolved, { root });
  }

  setMeta(meta: Partial<BrainMeta>): void {
    this.brain.setMeta(meta);
  }

  setTargets(targets: string[]): void {
    this.brain.setTargets(targets);
  }

  setPersona(md: string): void {
    this.brain.setPersona(md);
  }

  addFact(input: {
    text: string;
    importance?: number;
    visibility?: 'shareable' | 'personal';
  }): void {
    const item: Record<string, unknown> = {
      id: `fact-${++this.factCounter}`,
      kind: 'fact',
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    if (input.importance !== undefined) item.importance = input.importance;
    if (input.visibility !== undefined) item.visibility = input.visibility;
    this.brain.addMemory(item);
  }

  /** Bulk import: one durable fact per non-empty line. Returns how many were added. */
  importLines(text: string): number {
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) this.addFact({ text: line });
    return lines.length;
  }

  /** Import structured memory items (e.g. from a .jsonl export), filling missing fields. */
  importItems(items: Array<Record<string, unknown>>): number {
    const KINDS = ['fact', 'decision', 'preference', 'milestone', 'episodic'];
    let added = 0;
    for (const raw of items) {
      const text = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (!text) continue;
      const item: Record<string, unknown> = {
        id: typeof raw.id === 'string' && raw.id ? raw.id : `fact-${++this.factCounter}`,
        kind: typeof raw.kind === 'string' && KINDS.includes(raw.kind) ? raw.kind : 'fact',
        text,
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
      };
      if (typeof raw.importance === 'number') item.importance = raw.importance;
      if (raw.visibility === 'personal') item.visibility = 'personal';
      this.brain.addMemory(item);
      added++;
    }
    return added;
  }

  addMcpFromCatalog(id: string): void {
    this.brain.addMcpFromCatalog(id);
  }

  addSkillFromCatalog(name: string): void {
    this.brain.addSkillFromCatalog(name);
  }

  /** Add a skill not in the catalog (pasted or uploaded SKILL.md). */
  addCustomSkill(name: string, skillMd: string): void {
    const md = skillMd.trim() ? skillMd : `---\nname: ${name}\ndescription: ${name}\n---\n`;
    this.brain.addSkill(name, md);
  }

  /** Install a skill from anywhere: fetch a SKILL.md by URL. */
  async importSkillFromUrl(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
    this.addCustomSkill(skillNameFromUrl(url), await res.text());
  }

  /** Ensure a credential requirement exists for an MCP server's auth.credentialRef. */
  private ensureMcpCredential(auth: { type?: string; credentialRef?: string }): void {
    const ref = auth.credentialRef;
    if (!ref) return;
    const type =
      auth.type === 'bearer'
        ? 'bearer'
        : auth.type === 'header'
          ? 'header'
          : auth.type === 'oauth2'
            ? 'oauth2'
            : 'apiKey';
    this.brain.addCredential({ ref, label: ref, type, consumedBy: [], required: true });
  }

  /** Add a custom MCP server (validated by the schema). Throws on invalid input. */
  addCustomMcp(input: Record<string, unknown>): void {
    const server = { tools: { include: 'all' }, ...input };
    this.brain.addMcpServer(server);
    this.ensureMcpCredential((input.auth ?? {}) as { type?: string; credentialRef?: string });
  }

  /** Bulk-import MCP servers (e.g. an existing mcp/servers.json). Throws on invalid input. */
  importMcpServers(servers: Array<Record<string, unknown>>): number {
    let n = 0;
    for (const raw of servers) {
      this.brain.addMcpServer({ tools: { include: 'all' }, ...raw });
      this.ensureMcpCredential((raw.auth ?? {}) as { type?: string; credentialRef?: string });
      n++;
    }
    return n;
  }

  /** Search MCP hubs (MCP Registry + Smithery) for servers to add. */
  searchHubMcp(query: string): Promise<HubSearch<McpHubResult>> {
    return searchMcpHubs(query, defaultMcpSources());
  }

  /** Search skill hubs (GitHub repos) for skills to import. */
  searchHubSkills(query: string): Promise<HubSearch<SkillHubResult>> {
    return searchSkillHubs(query, defaultSkillSources());
  }

  /** Add a discovered MCP server (its server + every declared credential). Throws if invalid. */
  addMcpHubResult(result: McpHubResult): void {
    installMcpHubResult(this.brain, result);
  }

  removeMcp(id: string): void {
    this.brain.removeMcpServer(id);
  }

  removeSkill(name: string): void {
    this.brain.removeSkill(name);
  }

  addChannelFromCatalog(id: string): void {
    this.brain.addChannelFromCatalog(id);
  }

  removeChannel(id: string): void {
    this.brain.removeChannel(id);
  }

  /** Create an automation/flow (scheduled, event-triggered, or manual). */
  addTask(input: {
    name?: string;
    triggerType?: 'schedule' | 'event' | 'manual';
    cron?: string;
    event?: string;
    actionKind?: string;
    prompt?: string;
  }): void {
    const id = `task-${++this.taskCounter}`;
    const triggerType = input.triggerType ?? 'schedule';
    const trigger =
      triggerType === 'schedule'
        ? {
            type: 'schedule' as const,
            cron: input.cron && input.cron.trim() ? input.cron.trim() : '0 9 * * *',
          }
        : triggerType === 'event'
          ? {
              type: 'event' as const,
              event: input.event && input.event.trim() ? input.event.trim() : 'mention',
            }
          : { type: 'manual' as const };
    const action: { kind: string; prompt?: string } = {
      kind: input.actionKind?.trim() || 'prompt',
    };
    if (input.prompt && input.prompt.trim()) action.prompt = input.prompt.trim();
    this.brain.addTask({ id, name: input.name?.trim() || id, trigger, action, enabled: true });
  }

  removeTask(id: string): void {
    this.brain.removeTask(id);
  }

  state(): StudioState {
    const bundle = this.brain.toBundle();
    return { manifest: bundle.manifest(), validation: validateBundle(bundle) };
  }

  async export(opts: { sign?: boolean } = {}): Promise<ExportResult> {
    const bundle = this.brain.toBundle();
    const validation = validateBundle(bundle);
    let out = bundle;
    let signed = false;
    if (opts.sign) {
      if (!this.keypair) this.keypair = await generateKeypair();
      out = await sign(bundle, this.keypair.privateKey);
      signed = true;
    }
    const bytes = await pack(out);
    let verified = false;
    if (signed) verified = (await verify(out)).valid;
    return {
      filename: `${out.manifest().name}.uniqent`,
      bytesBase64: Buffer.from(bytes).toString('base64'),
      signed,
      verified,
      validation,
    };
  }
}
