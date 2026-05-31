import { Brain, MCP_CATALOG, SKILL_CATALOG, CHANNEL_CATALOG } from '@uniqent/builder';
import type { BrainMeta } from '@uniqent/builder';
import { validateBundle, generateKeypair, sign, pack, verify } from '@uniqent/core';
import type { ValidationResult, Keypair } from '@uniqent/core';
import type { Manifest } from '@uniqent/spec';

const DEFAULT_META: BrainMeta = {
  name: 'my-brain',
  displayName: 'My Brain',
  version: '0.1.0',
  description: 'A portable agent brain.',
  author: { name: 'Anonymous' },
  license: 'CC0-1.0',
  tags: [],
};

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
    };
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
