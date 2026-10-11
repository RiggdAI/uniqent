import { Bundle, PATHS, validateBundle } from '@uniqent/core/pure';
import type { ValidationResult } from '@uniqent/core/pure';
import {
  MemoryItem,
  McpServer,
  Channel,
  Task,
  ToolDecl,
  RuntimeConfig,
  CredentialRequirement,
  MemoryProfile,
  Manifest as ManifestSchema,
} from '@uniqent/spec';
import type {
  Manifest,
  Author,
  PermissionScope,
  MemoryItem as TMemoryItem,
  McpServer as TMcpServer,
  Channel as TChannel,
  Task as TTask,
  ToolDecl as TToolDecl,
  RuntimeConfig as TRuntimeConfig,
  CredentialRequirement as TCredentialRequirement,
  MemoryProfile as TMemoryProfile,
} from '@uniqent/spec';
import { deriveComponents, derivePermissions } from './derive.js';
import { MCP_CATALOG } from './catalog/mcp.js';
import { SKILL_CATALOG } from './catalog/skills.js';
import { CHANNEL_CATALOG } from './catalog/channels.js';

export interface BrainMeta {
  name: string;
  displayName: string;
  version: string;
  description: string;
  author: Author;
  license: string;
  tags: string[];
}

const META_KEYS = [
  'name',
  'displayName',
  'version',
  'description',
  'author',
  'license',
  'tags',
] as const satisfies ReadonlyArray<keyof BrainMeta>;

/** A setMeta patch field fails the manifest schema; nothing was changed. */
export class InvalidBrainMetaError extends Error {
  readonly field: keyof BrainMeta;
  constructor(field: keyof BrainMeta, detail: string) {
    super(`invalid brain meta "${field}": ${detail}`);
    this.name = 'InvalidBrainMetaError';
    this.field = field;
  }
}

/** A memory item id is already used by another item (ids must be unique across facts+episodic). */
export class DuplicateMemoryIdError extends Error {
  readonly id: string;
  constructor(id: string) {
    super(`duplicate memory id "${id}": memory item ids must be unique`);
    this.name = 'DuplicateMemoryIdError';
    this.id = id;
  }
}

/** Skill support files: text, or raw bytes for binary assets (kept byte-exact). */
export type SkillFiles = Record<string, string | Uint8Array>;

interface SkillEntry {
  skillMd: string;
  files?: SkillFiles;
}

/** Editable in-memory model of a brain that assembles a validated core Bundle. */
export class Brain {
  private meta: BrainMeta;
  private targets: string[] = [];
  private readmeMd?: string;
  private avatarFile?: { path: string; bytes: Uint8Array };
  private personaMd?: string;
  private policiesMd?: string;
  private profile?: TMemoryProfile;
  private facts: TMemoryItem[] = [];
  private episodic: TMemoryItem[] = [];
  private skillMap = new Map<string, SkillEntry>();
  private mcp: TMcpServer[] = [];
  private toolDecls: TToolDecl[] = [];
  private taskList: TTask[] = [];
  private channelList: TChannel[] = [];
  private runtimeCfg?: TRuntimeConfig;
  private credentialList: TCredentialRequirement[] = [];
  private declaredPermissions?: Partial<PermissionScope>;
  private suggestedPrompts?: string[];
  /** Bundle files the model has no field for, carried through byte-exact from fromBundle. */
  private extraFiles = new Map<string, Uint8Array>();

  private constructor(meta: BrainMeta) {
    this.meta = meta;
  }

  static create(meta: BrainMeta): Brain {
    return new Brain(meta);
  }

  /**
   * Patch the manifest metadata. Every present field is validated against the manifest schema
   * first; on the first invalid one this throws InvalidBrainMetaError and changes nothing.
   * Keys that are not BrainMeta fields are ignored.
   */
  setMeta(meta: Partial<BrainMeta>): void {
    let next: BrainMeta = { ...this.meta };
    for (const key of META_KEYS) {
      if (!(key in meta)) continue;
      const r = ManifestSchema.shape[key].safeParse(meta[key]);
      if (!r.success) {
        throw new InvalidBrainMetaError(key, r.error.issues.map((i) => i.message).join('; '));
      }
      next = { ...next, [key]: r.data };
    }
    this.meta = next;
  }
  /** Demo prompts advertised after install ("now ask it this"); the manifest's suggestedPrompts. */
  setSuggestedPrompts(prompts: string[]): void {
    this.suggestedPrompts = ManifestSchema.shape.suggestedPrompts.unwrap().parse(prompts);
  }
  getSuggestedPrompts(): string[] | undefined {
    return this.suggestedPrompts;
  }
  setTargets(targets: string[]): void {
    this.targets = [...targets];
  }
  setPersona(md: string): void {
    this.personaMd = md;
  }
  getPersona(): string | undefined {
    return this.personaMd;
  }
  /** Long-form "about this brain" README (markdown). Travels in the bundle as README.md. */
  setReadme(md: string): void {
    this.readmeMd = md.trim() ? md : undefined;
  }
  getReadme(): string | undefined {
    return this.readmeMd;
  }
  /** Set the brain's avatar from raw image bytes; ext must be png/jpg/jpeg/webp/gif/svg. */
  setAvatar(ext: string, bytes: Uint8Array): void {
    const e = ext.toLowerCase().replace(/^\./, '');
    const norm = e === 'jpeg' ? 'jpg' : e;
    if (!['png', 'jpg', 'webp', 'gif', 'svg'].includes(norm)) {
      throw new Error(`unsupported avatar type "${ext}" (use png/jpg/webp/gif/svg)`);
    }
    this.avatarFile = { path: `avatar.${norm}`, bytes };
  }
  clearAvatar(): void {
    this.avatarFile = undefined;
  }
  getAvatar(): { path: string; bytes: Uint8Array } | undefined {
    return this.avatarFile;
  }
  setPolicies(md: string): void {
    this.policiesMd = md;
  }
  setProfile(profile: unknown): void {
    this.profile = profile === undefined ? undefined : MemoryProfile.parse(profile);
  }
  getProfile(): TMemoryProfile | undefined {
    return this.profile;
  }

  /** Add one memory item; throws DuplicateMemoryIdError if its id is already used. */
  addMemory(item: unknown): void {
    const parsed = MemoryItem.parse(item);
    if (this.listMemory().some((m) => m.id === parsed.id)) {
      throw new DuplicateMemoryIdError(parsed.id);
    }
    if (parsed.kind === 'episodic') this.episodic.push(parsed);
    else this.facts.push(parsed);
  }
  /** All memory items (facts + episodic), for building the memory graph. */
  listMemory(): TMemoryItem[] {
    return [...this.facts, ...this.episodic];
  }
  removeMemory(id: string): void {
    this.facts = this.facts.filter((f) => f.id !== id);
    this.episodic = this.episodic.filter((f) => f.id !== id);
  }

  addSkill(name: string, skillMd: string, files?: SkillFiles): void {
    this.skillMap.set(name, files ? { skillMd, files } : { skillMd });
  }
  removeSkill(name: string): void {
    this.skillMap.delete(name);
  }

  addMcpServer(server: unknown): void {
    const parsed = McpServer.parse(server);
    this.mcp = this.mcp.filter((s) => s.id !== parsed.id).concat(parsed);
  }
  removeMcpServer(id: string): void {
    this.mcp = this.mcp.filter((s) => s.id !== id);
  }

  setTool(decl: unknown): void {
    const parsed = ToolDecl.parse(decl);
    this.toolDecls = this.toolDecls.filter((t) => t.id !== parsed.id).concat(parsed);
  }
  removeTool(id: string): void {
    this.toolDecls = this.toolDecls.filter((t) => t.id !== id);
  }

  addTask(task: unknown): void {
    const parsed = Task.parse(task);
    this.taskList = this.taskList.filter((t) => t.id !== parsed.id).concat(parsed);
  }
  removeTask(id: string): void {
    this.taskList = this.taskList.filter((t) => t.id !== id);
  }

  addChannel(channel: unknown): void {
    const parsed = Channel.parse(channel);
    this.channelList = this.channelList.filter((c) => c.id !== parsed.id).concat(parsed);
  }
  removeChannel(id: string): void {
    this.channelList = this.channelList.filter((c) => c.id !== id);
  }

  setRuntime(cfg: unknown): void {
    this.runtimeCfg = RuntimeConfig.parse(cfg);
  }
  /**
   * Declare permissions on top of what is derived from content (see derivePermissions): they can
   * widen the scope (filesystem, notes, extra endpoints, spawnsProcesses, fallback autonomy) but
   * never hide what the brain's MCP servers / runtime actually need.
   */
  setPermissions(p: Partial<PermissionScope>): void {
    this.declaredPermissions = p;
  }

  addCredential(req: unknown): void {
    const parsed = CredentialRequirement.parse(req);
    this.credentialList = this.credentialList.filter((c) => c.ref !== parsed.ref).concat(parsed);
  }
  removeCredential(ref: string): void {
    this.credentialList = this.credentialList.filter((c) => c.ref !== ref);
  }

  addMcpFromCatalog(id: string): void {
    const entry = MCP_CATALOG.find((e) => e.id === id);
    if (!entry) throw new Error(`unknown MCP catalog entry: ${id}`);
    this.addMcpServer(entry.server);
    if (entry.credential) this.addCredential(entry.credential);
  }
  addSkillFromCatalog(name: string): void {
    const entry = SKILL_CATALOG.find((e) => e.name === name);
    if (!entry) throw new Error(`unknown skill catalog entry: ${name}`);
    this.addSkill(entry.name, entry.skillMd);
  }

  addChannelFromCatalog(id: string): void {
    const entry = CHANNEL_CATALOG.find((e) => e.id === id);
    if (!entry) throw new Error(`unknown channel catalog entry: ${id}`);
    this.addChannel(entry.channel);
    if (entry.credential) this.addCredential(entry.credential);
  }

  private syncedCredentials(): TCredentialRequirement[] {
    return this.credentialList.map((c) => {
      const consumers = new Set(c.consumedBy);
      // A server consumes a ref via auth or a ${credentialRef:…} placeholder (stdio env, headers, args).
      const placeholder = `\${credentialRef:${c.ref}}`;
      for (const s of this.mcp)
        if (s.auth.credentialRef === c.ref || JSON.stringify(s).includes(placeholder))
          consumers.add(`mcp:${s.id}`);
      for (const ch of this.channelList)
        if (ch.credentialRef === c.ref) consumers.add(`channel:${ch.id}`);
      return { ...c, consumedBy: [...consumers].sort() };
    });
  }

  private buildManifest(): Manifest {
    const components = deriveComponents({
      hasPersona: this.personaMd !== undefined,
      facts: this.facts.length,
      episodic: this.episodic.length,
      hasProfile: this.profile !== undefined,
      skills: [...this.skillMap.keys()],
      mcp: this.mcp.map((s) => s.id),
      tools: this.toolDecls.map((t) => t.id),
      tasks: this.taskList.map((t) => t.id),
      channels: this.channelList.map((c) => c.id),
    });
    const permissions = derivePermissions(
      this.mcp,
      this.channelList,
      this.runtimeCfg,
      this.declaredPermissions,
    );
    return {
      specVersion: '0.1',
      name: this.meta.name,
      displayName: this.meta.displayName,
      version: this.meta.version,
      description: this.meta.description,
      author: this.meta.author,
      license: this.meta.license,
      tags: this.meta.tags,
      components,
      credentials: this.syncedCredentials(),
      permissions,
      compatibility: { targets: [...this.targets] },
      ...(this.suggestedPrompts !== undefined
        ? { suggestedPrompts: [...this.suggestedPrompts] }
        : {}),
    };
  }

  toBundle(): Bundle {
    const b = Bundle.empty();
    for (const [path, bytes] of this.extraFiles) b.set(path, bytes);
    if (this.readmeMd !== undefined) b.set(PATHS.readme, this.readmeMd);
    if (this.avatarFile) b.set(this.avatarFile.path, this.avatarFile.bytes);
    if (this.personaMd !== undefined) b.set(PATHS.persona, this.personaMd);
    if (this.policiesMd !== undefined) b.set(PATHS.policies, this.policiesMd);
    if (this.profile !== undefined) b.set(PATHS.profile, JSON.stringify(this.profile, null, 2));
    if (this.facts.length) {
      b.set(PATHS.facts, this.facts.map((f) => JSON.stringify(f)).join('\n') + '\n');
    }
    if (this.episodic.length) {
      b.set(PATHS.episodic, this.episodic.map((f) => JSON.stringify(f)).join('\n') + '\n');
    }
    for (const [name, s] of this.skillMap) {
      b.set(`skills/${name}/SKILL.md`, s.skillMd);
      if (s.files) {
        for (const [rel, content] of Object.entries(s.files))
          b.set(`skills/${name}/${rel}`, content);
      }
    }
    if (this.mcp.length) b.set(PATHS.mcp, JSON.stringify({ servers: this.mcp }, null, 2));
    if (this.toolDecls.length)
      b.set(PATHS.tools, JSON.stringify({ tools: this.toolDecls }, null, 2));
    if (this.channelList.length) {
      b.set(PATHS.channels, JSON.stringify({ channels: this.channelList }, null, 2));
    }
    for (const t of this.taskList) b.set(`tasks/${t.id}.json`, JSON.stringify(t, null, 2));
    if (this.runtimeCfg !== undefined)
      b.set(PATHS.runtime, JSON.stringify(this.runtimeCfg, null, 2));
    b.set(PATHS.manifest, JSON.stringify(this.buildManifest(), null, 2));
    return b;
  }

  validate(): ValidationResult {
    return validateBundle(this.toBundle());
  }

  /**
   * Load an editable Brain from a bundle. Round-trips losslessly: files the model has no field
   * for are kept byte-exact, skill files keep their raw bytes, and permissions stay derived from
   * content (only what the manifest declares beyond that is kept). The signature is dropped —
   * an edited brain must be re-signed. Throws DuplicateMemoryIdError on repeated memory ids.
   */
  static fromBundle(bundle: Bundle): Brain {
    const m = bundle.manifest();
    const brain = new Brain({
      name: m.name,
      displayName: m.displayName,
      version: m.version,
      description: m.description,
      author: m.author,
      license: m.license,
      tags: [...m.tags],
    });
    brain.targets = [...m.compatibility.targets];
    const readme = bundle.readme();
    if (readme !== undefined) brain.readmeMd = readme;
    const avatar = bundle.avatar();
    if (avatar !== undefined) brain.avatarFile = avatar;
    const persona = bundle.persona();
    if (persona !== undefined) brain.personaMd = persona;
    const policies = bundle.policies();
    if (policies !== undefined) brain.policiesMd = policies;
    const profile = bundle.memoryProfile();
    if (profile !== undefined) brain.profile = profile;
    brain.facts = bundle.memoryFacts();
    brain.episodic = bundle.memoryEpisodic();
    const memoryIds = new Set<string>();
    for (const item of brain.listMemory()) {
      if (memoryIds.has(item.id)) throw new DuplicateMemoryIdError(item.id);
      memoryIds.add(item.id);
    }
    const consumed = new Set<string>([...Object.values(PATHS), ...(avatar ? [avatar.path] : [])]);
    for (const name of bundle.skillNames()) {
      const skillMd = bundle.getText(`skills/${name}/SKILL.md`) ?? '';
      const prefix = `skills/${name}/`;
      const files: SkillFiles = {};
      for (const [p, bytes] of bundle.entries()) {
        if (!p.startsWith(prefix)) continue;
        consumed.add(p);
        if (p !== `${prefix}SKILL.md`) files[p.slice(prefix.length)] = bytes;
      }
      brain.skillMap.set(name, Object.keys(files).length ? { skillMd, files } : { skillMd });
    }
    brain.mcp = bundle.mcpServers();
    brain.channelList = bundle.channels();
    brain.toolDecls = bundle.tools();
    brain.taskList = bundle.tasks();
    const rt = bundle.runtime();
    if (rt !== undefined) brain.runtimeCfg = rt;
    brain.credentialList = [...m.credentials];
    if (m.suggestedPrompts !== undefined) brain.suggestedPrompts = [...m.suggestedPrompts];
    // Keep only what the manifest declares BEYOND what its content derives, so permissions keep
    // tracking later edits (a new stdio server, a runtime autonomy change, a removed endpoint).
    const derived = derivePermissions(brain.mcp, brain.channelList, undefined, undefined);
    brain.declaredPermissions = {
      filesystem: m.permissions.filesystem,
      network: {
        endpoints: m.permissions.network.endpoints.filter(
          (e) => !derived.network.endpoints.includes(e),
        ),
      },
      spawnsProcesses: m.permissions.spawnsProcesses && !derived.spawnsProcesses,
      ...(rt?.autonomy === undefined ? { autonomy: m.permissions.autonomy } : {}),
      ...(m.permissions.notes !== undefined ? { notes: m.permissions.notes } : {}),
    };
    for (const [p, bytes] of bundle.entries()) {
      // tasks/*.json are all read by bundle.tasks() and re-emitted from the task list.
      if (consumed.has(p) || (p.startsWith('tasks/') && p.endsWith('.json'))) continue;
      brain.extraFiles.set(p, bytes);
    }
    return brain;
  }
}
