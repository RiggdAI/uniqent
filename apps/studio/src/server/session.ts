import { Brain, MCP_CATALOG, SKILL_CATALOG } from '@uniqent/builder';
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

  constructor() {
    this.brain = Brain.create({ ...DEFAULT_META });
  }

  reset(): void {
    this.brain = Brain.create({ ...DEFAULT_META });
    this.factCounter = 0;
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
