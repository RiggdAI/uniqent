import {
  Manifest,
  Signature,
  MemoryItem,
  MemoryProfile,
  McpServersFile,
  ChannelsFile,
  ToolsFile,
  Task,
  RuntimeConfig,
} from '@uniqent/spec';
import type {
  Manifest as TManifest,
  Signature as TSignature,
  MemoryItem as TMemoryItem,
  MemoryProfile as TMemoryProfile,
  McpServer,
  Channel,
  ToolDecl,
  Task as TTask,
  RuntimeConfig as TRuntimeConfig,
} from '@uniqent/spec';
import { BundleFormatError } from './errors.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

export const PATHS = {
  manifest: 'uniqent.json',
  signature: 'signature.json',
  persona: 'identity/persona.md',
  policies: 'identity/policies.md',
  profile: 'memory/profile.json',
  facts: 'memory/facts.jsonl',
  episodic: 'memory/episodic.jsonl',
  mcp: 'mcp/servers.json',
  channels: 'channels/channels.json',
  tools: 'tools/tools.json',
  runtime: 'setup/runtime.json',
} as const;

export class Bundle {
  private readonly fileMap: Map<string, Uint8Array>;

  private constructor(files: Map<string, Uint8Array>) {
    this.fileMap = files;
  }

  static empty(): Bundle {
    return new Bundle(new Map());
  }

  static fromFiles(files: Map<string, Uint8Array>): Bundle {
    return new Bundle(new Map(files));
  }

  has(path: string): boolean {
    return this.fileMap.has(path);
  }

  get(path: string): Uint8Array | undefined {
    return this.fileMap.get(path);
  }

  getText(path: string): string | undefined {
    const bytes = this.fileMap.get(path);
    return bytes === undefined ? undefined : dec.decode(bytes);
  }

  set(path: string, content: Uint8Array | string): void {
    this.fileMap.set(path, typeof content === 'string' ? enc.encode(content) : content);
  }

  delete(path: string): boolean {
    return this.fileMap.delete(path);
  }

  list(): string[] {
    return [...this.fileMap.keys()].sort();
  }

  entries(): Array<[string, Uint8Array]> {
    return [...this.fileMap.entries()];
  }

  private parseJson(path: string): unknown {
    const text = this.getText(path);
    if (text === undefined) throw new BundleFormatError(`missing ${path}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new BundleFormatError(`${path} is not valid JSON`);
    }
  }

  manifest(): TManifest {
    const r = Manifest.safeParse(this.parseJson(PATHS.manifest));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.manifest} failed schema: ${r.error.message}`);
    return r.data;
  }

  signature(): TSignature | undefined {
    if (!this.has(PATHS.signature)) return undefined;
    const r = Signature.safeParse(this.parseJson(PATHS.signature));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.signature} failed schema: ${r.error.message}`);
    return r.data;
  }

  persona(): string | undefined {
    return this.getText(PATHS.persona);
  }

  policies(): string | undefined {
    return this.getText(PATHS.policies);
  }

  memoryProfile(): TMemoryProfile | undefined {
    if (!this.has(PATHS.profile)) return undefined;
    const r = MemoryProfile.safeParse(this.parseJson(PATHS.profile));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.profile} failed schema: ${r.error.message}`);
    return r.data;
  }

  private memoryLines(path: string): TMemoryItem[] {
    const text = this.getText(path);
    if (text === undefined) return [];
    const items: TMemoryItem[] = [];
    text.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch {
        throw new BundleFormatError(`${path}:${i + 1} is not valid JSON`);
      }
      const r = MemoryItem.safeParse(json);
      if (!r.success)
        throw new BundleFormatError(`${path}:${i + 1} failed schema: ${r.error.message}`);
      items.push(r.data);
    });
    return items;
  }

  memoryFacts(): TMemoryItem[] {
    return this.memoryLines(PATHS.facts);
  }

  memoryEpisodic(): TMemoryItem[] {
    return this.memoryLines(PATHS.episodic);
  }

  mcpServers(): McpServer[] {
    if (!this.has(PATHS.mcp)) return [];
    const r = McpServersFile.safeParse(this.parseJson(PATHS.mcp));
    if (!r.success) throw new BundleFormatError(`${PATHS.mcp} failed schema: ${r.error.message}`);
    return r.data.servers;
  }

  channels(): Channel[] {
    if (!this.has(PATHS.channels)) return [];
    const r = ChannelsFile.safeParse(this.parseJson(PATHS.channels));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.channels} failed schema: ${r.error.message}`);
    return r.data.channels;
  }

  tools(): ToolDecl[] {
    if (!this.has(PATHS.tools)) return [];
    const r = ToolsFile.safeParse(this.parseJson(PATHS.tools));
    if (!r.success) throw new BundleFormatError(`${PATHS.tools} failed schema: ${r.error.message}`);
    return r.data.tools;
  }

  tasks(): TTask[] {
    const out: TTask[] = [];
    for (const path of this.list()) {
      if (!path.startsWith('tasks/') || !path.endsWith('.json')) continue;
      const r = Task.safeParse(this.parseJson(path));
      if (!r.success) throw new BundleFormatError(`${path} failed schema: ${r.error.message}`);
      out.push(r.data);
    }
    return out;
  }

  runtime(): TRuntimeConfig | undefined {
    if (!this.has(PATHS.runtime)) return undefined;
    const r = RuntimeConfig.safeParse(this.parseJson(PATHS.runtime));
    if (!r.success)
      throw new BundleFormatError(`${PATHS.runtime} failed schema: ${r.error.message}`);
    return r.data;
  }

  skillNames(): string[] {
    const names = new Set<string>();
    for (const path of this.list()) {
      const m = /^skills\/([^/]+)\/SKILL\.md$/.exec(path);
      if (m && m[1]) names.add(m[1]);
    }
    return [...names].sort();
  }
}
