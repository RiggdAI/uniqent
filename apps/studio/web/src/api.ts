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

  // ── Later-phase stubs (soon in native, existing fetch in browser) ─────────
  addMemory: (text: string, importance?: number) =>
    isNative ? soon() : post<StudioState>('/api/memory', { text, importance }),
  getProfile: () => (isNative ? soon() : get<{ profile: Record<string, string> }>('/api/profile')),
  setProfile: (profile: Record<string, string>) =>
    isNative ? soon() : post<StudioState>('/api/profile', { profile }),
  importMemory: (payload: { text?: string; items?: unknown[]; markdown?: string }) =>
    isNative ? soon() : post<StudioState>('/api/memory/import', payload),
  memoryGraph: () => (isNative ? soon() : get<MemoryGraph>('/api/memory/graph')),
  previewMemory: (text: string) =>
    isNative
      ? soon()
      : post<{ items: ImportedMemoryItem[]; graph: MemoryGraph }>('/api/memory/preview', { text }),
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
  addMcp: (id: string) =>
    isNative ? soon() : post<StudioState>(`/api/mcp/catalog/${encodeURIComponent(id)}`, {}),
  addSkill: (name: string) =>
    isNative ? soon() : post<StudioState>(`/api/skill/catalog/${encodeURIComponent(name)}`, {}),
  addCustomSkill: (name: string, skillMd: string) =>
    isNative ? soon() : post<StudioState>('/api/skill/custom', { name, skillMd }),
  importSkillFromUrl: (url: string) =>
    isNative ? soon() : post<StudioState>('/api/skill/url', { url }),
  addCustomMcp: (server: Record<string, unknown>) =>
    isNative ? soon() : post<StudioState>('/api/mcp/custom', server),
  importMcpServers: (servers: unknown[]) =>
    isNative ? soon() : post<StudioState>('/api/mcp/import', { servers }),
  pasteMcpPreview: (text: string) =>
    isNative ? soon() : post<McpNormalizePreview>('/api/mcp/paste', { text }),
  addPastedMcp: (text: string) =>
    isNative ? soon() : post<StudioState>('/api/mcp/paste/add', { text }),
  removeMcp: (id: string) => (isNative ? soon() : post<StudioState>('/api/mcp/remove', { id })),
  removeSkill: (name: string) =>
    isNative ? soon() : post<StudioState>('/api/skill/remove', { name }),
  addChannel: (id: string) =>
    isNative ? soon() : post<StudioState>(`/api/channel/catalog/${encodeURIComponent(id)}`, {}),
  removeChannel: (id: string) =>
    isNative ? soon() : post<StudioState>('/api/channel/remove', { id }),
  addTask: (payload: TaskInput) =>
    isNative ? soon() : post<StudioState>('/api/task/add', payload),
  removeTask: (id: string) => (isNative ? soon() : post<StudioState>('/api/task/remove', { id })),
  export: (sign: boolean) =>
    isNative
      ? invoke<ExportResult>('export', { sign })
      : post<ExportResult>('/api/export', { sign }),
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
