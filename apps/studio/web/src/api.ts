import { invoke } from '@tauri-apps/api/core';

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
} from './types';

const isNative = typeof (globalThis as Record<string, unknown>).__TAURI_INTERNALS__ !== 'undefined';

const SOON = 'not yet available in the native app — coming in a later phase';
const soon = () => Promise.reject(new Error(SOON));

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

  // ── Phase 3b/4 stubs (hubs, publish, vault, install — coming later) ───────
  memoryHub: (query: string, registry?: string) =>
    isNative ? soon() : post<MemoryHubSearch>('/api/memory/hub/search', { query, registry }),
  addMemoryPack: (slug: string, registry?: string) =>
    isNative ? soon() : post<StudioState>('/api/memory/hub/add', { slug, registry }),
  publishMemory: (token: string, registry?: string) =>
    isNative
      ? soon()
      : post<{ result: { slug: string; factCount: number; url?: string; persisted?: boolean } }>(
          '/api/memory/hub/publish',
          { token, registry },
        ),
  previewVault: (dir: string) =>
    isNative
      ? soon()
      : post<{ result: VaultImport; graph: MemoryGraph }>('/api/memory/vault/preview', { dir }),
  importVault: (dir: string, opts?: { persona?: boolean; profile?: boolean }) =>
    isNative
      ? soon()
      : post<{ state: StudioState; stats: VaultImport['stats'] }>('/api/memory/vault/import', {
          dir,
          ...opts,
        }),
  // importSkillFromUrl fetches a remote URL — stays stubbed until network phase
  importSkillFromUrl: (url: string) =>
    isNative ? soon() : post<StudioState>('/api/skill/url', { url }),
  addPastedMcp: (text: string) =>
    isNative
      ? invoke<StudioState>('add_pasted_mcp', { text })
      : post<StudioState>('/api/mcp/paste/add', { text }),
  installPlan: (target: string, root: string) =>
    isNative ? soon() : post<InstallPlan>('/api/install/plan', { target, root }),
  install: (target: string, root: string, creds: Record<string, string>) =>
    isNative ? soon() : post<InstallResult>('/api/install', { target, root, creds }),
  hubMcp: (query: string) =>
    isNative ? soon() : post<HubSearch<McpHubResult>>('/api/hub/mcp/search', { query }),
  hubSkills: (query: string) =>
    isNative ? soon() : post<HubSearch<SkillHubResult>>('/api/hub/skills/search', { query }),
  addHubMcp: (result: McpHubResult) =>
    isNative ? soon() : post<StudioState>('/api/hub/mcp/add', { result }),
  addHubSkill: (url: string) =>
    isNative ? soon() : post<StudioState>('/api/hub/skill/add', { url }),
  hubIndexes: () => (isNative ? soon() : get<{ indexes: string[] }>('/api/hub/indexes')),
  setHubIndexes: (urls: string[]) =>
    isNative ? soon() : post<{ indexes: string[] }>('/api/hub/indexes', { urls }),
};
