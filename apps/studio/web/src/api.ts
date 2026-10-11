import { invoke } from '@tauri-apps/api/core';
import type { TargetId } from '@uniqent/builder/brain';
import * as native from './native';
import { captureAgent, type CaptureResult } from './capture';
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
  InstallPlan,
  InstallResult,
  HubSearch,
  McpHubResult,
  McpNormalizePreview,
  SkillHubResult,
  MemoryGraph,
  ImportedMemoryItem,
  MemoryHubSearch,
  VaultImport,
  FrameworkHomes,
  OpenedBundle,
} from './types';

export const isNative =
  typeof (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined';

/** Native-only features have no route on the old local server (the browser build); `cli` is the CLI equivalent. */
const needsNative = <T>(what: string, cli: string): Promise<T> =>
  Promise.reject(new Error(`${what} needs the native app; use \`${cli}\` from the CLI`));

async function unwrap<T>(res: Response): Promise<T> {
  const json = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json;
}

async function get<T>(url: string): Promise<T> {
  return unwrap<T>(await fetch(url));
}

async function post<T>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

export const api = {
  // ── Implemented native commands ──────────────────────────────────────────
  state: () => (isNative ? invoke<StudioState>('state') : get<StudioState>('/api/state')),
  catalog: () => (isNative ? invoke<CatalogView>('catalog') : get<CatalogView>('/api/catalog')),
  setMeta: (meta: Record<string, unknown>) =>
    isNative ? invoke<StudioState>('set_meta', { meta }) : post<StudioState>('/api/meta', meta),
  setTargets: (targets: string[]) =>
    isNative
      ? invoke<StudioState>('set_targets', { targets })
      : post<StudioState>('/api/targets', { targets }),
  setPersona: (persona: string) =>
    isNative
      ? invoke<StudioState>('set_persona', { persona })
      : post<StudioState>('/api/persona', { persona }),
  setReadme: (readme: string) =>
    isNative
      ? invoke<StudioState>('set_readme', { readme })
      : post<StudioState>('/api/readme', { readme }),
  setAvatar: (dataUrl: string) =>
    isNative
      ? invoke<StudioState>('set_avatar', { dataUrl })
      : post<StudioState>('/api/avatar', { dataUrl }),
  removeAvatar: () =>
    isNative ? invoke<StudioState>('remove_avatar') : post<StudioState>('/api/avatar/remove', {}),
  reset: () => (isNative ? invoke<StudioState>('reset') : post<StudioState>('/api/reset', {})),

  // ── Phase 3a: content commands (now native) ───────────────────────────────
  addMcp: (id: string) =>
    isNative
      ? invoke<StudioState>('add_mcp_catalog', { id })
      : post<StudioState>(`/api/mcp/catalog/${encodeURIComponent(id)}`, {}),
  addCustomMcp: (server: Record<string, unknown>) =>
    isNative
      ? invoke<StudioState>('add_custom_mcp', { server })
      : post<StudioState>('/api/mcp/custom', server),
  importMcpServers: (servers: unknown[]) =>
    isNative
      ? invoke<StudioState>('import_mcp_servers', { servers })
      : post<StudioState>('/api/mcp/import', { servers }),
  pasteMcpPreview: (text: string) =>
    isNative
      ? invoke<McpNormalizePreview>('paste_mcp_preview', { text })
      : post<McpNormalizePreview>('/api/mcp/paste', { text }),
  removeMcp: (id: string) =>
    isNative
      ? invoke<StudioState>('remove_mcp', { id })
      : post<StudioState>('/api/mcp/remove', { id }),
  addSkill: (name: string) =>
    isNative
      ? invoke<StudioState>('add_skill_catalog', { name })
      : post<StudioState>(`/api/skill/catalog/${encodeURIComponent(name)}`, {}),
  addCustomSkill: (name: string, skillMd: string) =>
    isNative
      ? invoke<StudioState>('add_custom_skill', { name, skillMd })
      : post<StudioState>('/api/skill/custom', { name, skillMd }),
  removeSkill: (name: string) =>
    isNative
      ? invoke<StudioState>('remove_skill', { name })
      : post<StudioState>('/api/skill/remove', { name }),
  addChannel: (id: string) =>
    isNative
      ? invoke<StudioState>('add_channel_catalog', { id })
      : post<StudioState>(`/api/channel/catalog/${encodeURIComponent(id)}`, {}),
  removeChannel: (id: string) =>
    isNative
      ? invoke<StudioState>('remove_channel', { id })
      : post<StudioState>('/api/channel/remove', { id }),
  addTask: (payload: TaskInput) =>
    isNative
      ? invoke<StudioState>('add_task', { payload })
      : post<StudioState>('/api/task/add', payload),
  removeTask: (id: string) =>
    isNative
      ? invoke<StudioState>('remove_task', { id })
      : post<StudioState>('/api/task/remove', { id }),
  addMemory: (text: string, importance?: number) =>
    isNative
      ? invoke<StudioState>('add_memory', { text, importance })
      : post<StudioState>('/api/memory', { text, importance }),
  importMemory: (payload: { text?: string; items?: unknown[]; markdown?: string }) =>
    isNative
      ? invoke<StudioState>('import_memory', { payload })
      : post<StudioState>('/api/memory/import', payload),
  previewMemory: (text: string) =>
    isNative
      ? invoke<{ items: ImportedMemoryItem[]; graph: MemoryGraph }>('preview_memory', { text })
      : post<{ items: ImportedMemoryItem[]; graph: MemoryGraph }>('/api/memory/preview', { text }),
  memoryGraph: () =>
    isNative ? invoke<MemoryGraph>('memory_graph') : get<MemoryGraph>('/api/memory/graph'),
  getProfile: () =>
    isNative
      ? invoke<{ profile: Record<string, string> }>('get_profile')
      : get<{ profile: Record<string, string> }>('/api/profile'),
  setProfile: (profile: Record<string, string>) =>
    isNative
      ? invoke<StudioState>('set_profile', { profile })
      : post<StudioState>('/api/profile', { profile }),
  export: (sign: boolean) =>
    isNative
      ? invoke<ExportResult>('export', { sign })
      : post<ExportResult>('/api/export', { sign }),

  // ── Phase 3b: hubs, publish, vault, skill-from-URL (native: shared TS logic + Rust) ────
  memoryHub: (query: string, registry?: string) =>
    isNative
      ? native.memoryHub(query, registry ?? '')
      : post<MemoryHubSearch>('/api/memory/hub/search', { query, registry }),
  addMemoryPack: (slug: string, registry?: string) =>
    isNative
      ? native.addMemoryPack(slug, registry ?? '')
      : post<StudioState>('/api/memory/hub/add', { slug, registry }),
  publishMemory: (token: string, registry?: string) =>
    isNative
      ? native.publishMemory(token, registry ?? '')
      : post<{ result: { slug: string; factCount: number; url?: string; persisted?: boolean } }>(
          '/api/memory/hub/publish',
          { token, registry },
        ),
  previewVault: (dir: string) =>
    isNative
      ? native.previewVault(dir)
      : post<{ result: VaultImport; graph: MemoryGraph }>('/api/memory/vault/preview', { dir }),
  importVault: (dir: string, opts?: { persona?: boolean; profile?: boolean }) =>
    isNative
      ? native.importVaultDir(dir, {
          persona: opts?.persona !== false,
          profile: opts?.profile !== false,
        })
      : post<{ state: StudioState; stats: VaultImport['stats'] }>('/api/memory/vault/import', {
          dir,
          ...opts,
        }),
  /** Native only: the OS folder picker (Rust grants read access to the chosen folder). */
  chooseFolder: () =>
    isNative
      ? native.chooseFolder()
      : Promise.reject(new Error('folder picking needs the native app; type the path instead')),
  importSkillFromUrl: (url: string) =>
    isNative ? native.importSkillFromUrl(url) : post<StudioState>('/api/skill/url', { url }),
  addPastedMcp: (text: string) =>
    isNative
      ? invoke<StudioState>('add_pasted_mcp', { text })
      : post<StudioState>('/api/mcp/paste/add', { text }),
  hubMcp: (query: string) =>
    isNative
      ? native.hubMcp(query)
      : post<HubSearch<McpHubResult>>('/api/hub/mcp/search', { query }),
  hubSkills: (query: string) =>
    isNative
      ? native.hubSkills(query)
      : post<HubSearch<SkillHubResult>>('/api/hub/skills/search', { query }),
  addHubMcp: (result: McpHubResult) =>
    isNative ? native.addHubMcp(result) : post<StudioState>('/api/hub/mcp/add', { result }),
  addHubSkill: (url: string, name: string) =>
    isNative
      ? native.addHubSkill(url, name)
      : post<StudioState>('/api/hub/skill/add', { url, name }),
  hubIndexes: () =>
    isNative ? native.hubIndexes() : get<{ indexes: string[] }>('/api/hub/indexes'),
  setHubIndexes: (urls: string[]) =>
    isNative
      ? native.setHubIndexes(urls)
      : post<{ indexes: string[] }>('/api/hub/indexes', { urls }),

  // ── Phase 4: install into an agent (pure adapters in the webview, file I/O in Rust) ──
  installPlan: (target: TargetId, root: string) =>
    isNative ? planInstall(target, root) : post<InstallPlan>('/api/install/plan', { target, root }),
  /** The writes and notes the typed credentials produce, writing nothing (shown before confirming). */
  installPreview: (target: TargetId, root: string, creds: Record<string, string>) =>
    isNative
      ? previewInstall(target, root, creds).then(reviewOf)
      : needsNative<ReviewedInstall>('reviewing install changes', 'uniqent install'),
  /** Installs only when the result still matches `reviewed` (see applyInstall). */
  install: (
    target: TargetId,
    root: string,
    creds: Record<string, string>,
    reviewed: ReviewedInstall,
  ) =>
    isNative
      ? applyInstall(target, root, creds, reviewed)
      : post<InstallResult>('/api/install', { target, root, creds }),
  frameworkHomes: () =>
    isNative
      ? native.frameworkHomes()
      : needsNative<FrameworkHomes>('finding agent frameworks', 'uniqent install'),
  /** The project markers a picked folder holds (see targets.ts folderChoices). */
  folderTargets: (dir: string) =>
    isNative
      ? native.folderMarkers(dir)
      : needsNative<string[]>('inspecting a picked folder', 'uniqent install'),

  // ── Phase 4: capture an agent; open and save .uniqent bundles (dialogs and files in Rust) ──
  /** Replaces the session with the captured agent (episodic and personal memory left out). */
  capture: (target: TargetId, root: string) =>
    isNative
      ? captureAgent(target, root)
      : needsNative<CaptureResult>('capturing an agent', 'uniqent export'),
  /** The native open dialog; null when cancelled. A signed bundle that fails to verify is refused. */
  openBundle: () =>
    isNative
      ? native.call<OpenedBundle | null>('open_bundle')
      : needsNative<OpenedBundle | null>('opening a .uniqent', 'uniqent inspect'),
  /** A `.uniqent` the user dropped on the window (only paths Rust granted from the drop). */
  openDroppedBundle: (path: string) =>
    isNative
      ? native.call<OpenedBundle>('open_dropped_bundle', { path })
      : needsNative<OpenedBundle>('opening a dropped .uniqent', 'uniqent inspect'),
  /** The native save dialog, always signed; the saved path, or null when cancelled. */
  saveBundle: () =>
    isNative
      ? native.call<string | null>('save_bundle')
      : needsNative<string | null>('saving a signed .uniqent', 'uniqent pack'),
};
