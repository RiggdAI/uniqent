import type { TargetId } from '@uniqent/builder/brain';
import * as native from './native';
import { captureAgent } from './capture';
import {
  applyInstall,
  planInstall,
  previewInstall,
  reviewOf,
  type ReviewedInstall,
} from './install';

import type {
  StudioState,
  CatalogView,
  ExportResult,
  TaskInput,
  McpHubResult,
  McpNormalizePreview,
  MemoryGraph,
  ImportedMemoryItem,
  OpenedBundle,
} from './types';

const { call } = native;

export const api = {
  state: () => call<StudioState>('state'),
  catalog: () => call<CatalogView>('catalog'),
  setMeta: (meta: Record<string, unknown>) => call<StudioState>('set_meta', { meta }),
  setTargets: (targets: string[]) => call<StudioState>('set_targets', { targets }),
  setPersona: (persona: string) => call<StudioState>('set_persona', { persona }),
  setReadme: (readme: string) => call<StudioState>('set_readme', { readme }),
  setAvatar: (dataUrl: string) => call<StudioState>('set_avatar', { dataUrl }),
  removeAvatar: () => call<StudioState>('remove_avatar'),
  reset: () => call<StudioState>('reset'),

  addMcp: (id: string) => call<StudioState>('add_mcp_catalog', { id }),
  addCustomMcp: (server: Record<string, unknown>) =>
    call<StudioState>('add_custom_mcp', { server }),
  importMcpServers: (servers: unknown[]) => call<StudioState>('import_mcp_servers', { servers }),
  pasteMcpPreview: (text: string) => call<McpNormalizePreview>('paste_mcp_preview', { text }),
  removeMcp: (id: string) => call<StudioState>('remove_mcp', { id }),
  addSkill: (name: string) => call<StudioState>('add_skill_catalog', { name }),
  addCustomSkill: (name: string, skillMd: string) =>
    call<StudioState>('add_custom_skill', { name, skillMd }),
  removeSkill: (name: string) => call<StudioState>('remove_skill', { name }),
  addChannel: (id: string) => call<StudioState>('add_channel_catalog', { id }),
  removeChannel: (id: string) => call<StudioState>('remove_channel', { id }),
  addTask: (payload: TaskInput) => call<StudioState>('add_task', { payload }),
  removeTask: (id: string) => call<StudioState>('remove_task', { id }),
  addMemory: (text: string, importance?: number) =>
    call<StudioState>('add_memory', { text, importance }),
  importMemory: (payload: { text?: string; items?: unknown[]; markdown?: string }) =>
    call<StudioState>('import_memory', { payload }),
  previewMemory: (text: string) =>
    call<{ items: ImportedMemoryItem[]; graph: MemoryGraph }>('preview_memory', { text }),
  memoryGraph: () => call<MemoryGraph>('memory_graph'),
  getProfile: () => call<{ profile: Record<string, string> }>('get_profile'),
  setProfile: (profile: Record<string, string>) => call<StudioState>('set_profile', { profile }),
  export: (sign: boolean) => call<ExportResult>('export', { sign }),

  // ── Hubs, publish, vault, skill-from-URL (shared pure TS + Rust, see native.ts) ──
  memoryHub: (query: string, registry?: string) => native.memoryHub(query, registry ?? ''),
  addMemoryPack: (slug: string, registry?: string) => native.addMemoryPack(slug, registry ?? ''),
  publishMemory: (token: string, registry?: string) => native.publishMemory(token, registry ?? ''),
  previewVault: (dir: string) => native.previewVault(dir),
  importVault: (dir: string, opts?: { persona?: boolean; profile?: boolean }) =>
    native.importVaultDir(dir, {
      persona: opts?.persona !== false,
      profile: opts?.profile !== false,
    }),
  /** The OS folder picker (Rust grants read access to the chosen folder). */
  chooseFolder: () => native.chooseFolder(),
  importSkillFromUrl: (url: string) => native.importSkillFromUrl(url),
  addPastedMcp: (text: string) => call<StudioState>('add_pasted_mcp', { text }),
  hubMcp: (query: string) => native.hubMcp(query),
  hubSkills: (query: string) => native.hubSkills(query),
  addHubMcp: (result: McpHubResult) => native.addHubMcp(result),
  addHubSkill: (url: string, name: string) => native.addHubSkill(url, name),
  hubIndexes: () => native.hubIndexes(),
  setHubIndexes: (urls: string[]) => native.setHubIndexes(urls),

  // ── Install into an agent (pure adapters in the webview, file I/O in Rust) ──
  installPlan: (target: TargetId, root: string) => planInstall(target, root),
  /** The writes and notes the typed credentials produce, writing nothing (shown before confirming). */
  installPreview: (target: TargetId, root: string, creds: Record<string, string>) =>
    previewInstall(target, root, creds).then(reviewOf),
  /** Installs only when the result still matches `reviewed` (see applyInstall). */
  install: (
    target: TargetId,
    root: string,
    creds: Record<string, string>,
    reviewed: ReviewedInstall,
  ) => applyInstall(target, root, creds, reviewed),
  frameworkHomes: () => native.frameworkHomes(),
  /** The project markers a picked folder holds (see targets.ts folderChoices). */
  folderTargets: (dir: string) => native.folderMarkers(dir),

  // ── Capture an agent; open and save .uniqent bundles (dialogs and files in Rust) ──
  /** Replaces the session with the captured agent (episodic and personal memory left out). */
  capture: (target: TargetId, root: string) => captureAgent(target, root),
  /** The native open dialog; null when cancelled. A signed bundle that fails to verify is refused. */
  openBundle: () => call<OpenedBundle | null>('open_bundle'),
  /** A `.uniqent` the user dropped on the window (only paths Rust granted from the drop). */
  openDroppedBundle: (path: string) => call<OpenedBundle>('open_dropped_bundle', { path }),
  /** The native save dialog, always signed; the saved path, or null when cancelled. */
  saveBundle: () => call<string | null>('save_bundle'),
};
