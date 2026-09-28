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
  readme: 'README.md',
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

// C0 control characters and DEL. A newline in a path would make the canonical digest ambiguous.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

const PATH_RULES: Array<{ reason: string; bad: (path: string) => boolean }> = [
  { reason: 'is empty', bad: (p) => p.length === 0 },
  { reason: 'is absolute', bad: (p) => p.startsWith('/') },
  { reason: 'contains a backslash', bad: (p) => p.includes('\\') },
  { reason: 'contains a control character', bad: (p) => CONTROL_CHAR_RE.test(p) },
  {
    reason: "contains an empty, '.' or '..' segment",
    bad: (p) => p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..'),
  },
];

/**
 * Assert a bundle-relative file path is safe and canonical: relative, '/'-separated, no empty,
 * '.' or '..' segments, no backslashes, no control characters. Every path that enters a Bundle
 * passes through here, so writers can join it under a root without escaping it and the canonical
 * digest (`path\nhash\n` lines) stays unambiguous.
 */
export function assertBundlePath(path: string): void {
  const rule = PATH_RULES.find((r) => r.bad(path));
  if (rule)
    throw new BundleFormatError(`invalid bundle path ${JSON.stringify(path)}: ${rule.reason}`);
}

export class Bundle {
  private readonly fileMap: Map<string, Uint8Array>;

  private constructor(files: Map<string, Uint8Array>) {
    this.fileMap = files;
  }

  static empty(): Bundle {
    return new Bundle(new Map());
  }

  static fromFiles(files: Map<string, Uint8Array>): Bundle {
    for (const path of files.keys()) assertBundlePath(path);
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
    assertBundlePath(path);
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

  readme(): string | undefined {
    return this.getText(PATHS.readme);
  }

  /** The brain's avatar image (avatar.png|jpg|webp|gif|svg), if present. Binary, travels signed. */
  avatar(): { path: string; bytes: Uint8Array } | undefined {
    const path = [...this.fileMap.keys()].find((p) =>
      /^avatar\.(png|jpe?g|webp|gif|svg)$/i.test(p),
    );
    if (!path) return undefined;
    return { path, bytes: this.fileMap.get(path)! };
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
