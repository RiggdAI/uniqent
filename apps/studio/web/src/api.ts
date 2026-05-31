import type {
  StudioState,
  CatalogView,
  ExportResult,
  TaskInput,
  InstallPlan,
  InstallResult,
  HubSearch,
  McpHubResult,
  SkillHubResult,
} from './types';

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
  state: () => get<StudioState>('/api/state'),
  catalog: () => get<CatalogView>('/api/catalog'),
  setMeta: (meta: Record<string, unknown>) => post<StudioState>('/api/meta', meta),
  setTargets: (targets: string[]) => post<StudioState>('/api/targets', { targets }),
  setPersona: (persona: string) => post<StudioState>('/api/persona', { persona }),
  addMemory: (text: string, importance?: number) =>
    post<StudioState>('/api/memory', { text, importance }),
  getProfile: () => get<{ profile: Record<string, string> }>('/api/profile'),
  setProfile: (profile: Record<string, string>) => post<StudioState>('/api/profile', { profile }),
  importMemory: (payload: { text?: string; items?: unknown[] }) =>
    post<StudioState>('/api/memory/import', payload),
  addMcp: (id: string) => post<StudioState>(`/api/mcp/catalog/${encodeURIComponent(id)}`, {}),
  addSkill: (name: string) =>
    post<StudioState>(`/api/skill/catalog/${encodeURIComponent(name)}`, {}),
  addCustomSkill: (name: string, skillMd: string) =>
    post<StudioState>('/api/skill/custom', { name, skillMd }),
  importSkillFromUrl: (url: string) => post<StudioState>('/api/skill/url', { url }),
  addCustomMcp: (server: Record<string, unknown>) => post<StudioState>('/api/mcp/custom', server),
  importMcpServers: (servers: unknown[]) => post<StudioState>('/api/mcp/import', { servers }),
  removeMcp: (id: string) => post<StudioState>('/api/mcp/remove', { id }),
  removeSkill: (name: string) => post<StudioState>('/api/skill/remove', { name }),
  addChannel: (id: string) =>
    post<StudioState>(`/api/channel/catalog/${encodeURIComponent(id)}`, {}),
  removeChannel: (id: string) => post<StudioState>('/api/channel/remove', { id }),
  addTask: (payload: TaskInput) => post<StudioState>('/api/task/add', payload),
  removeTask: (id: string) => post<StudioState>('/api/task/remove', { id }),
  reset: () => post<StudioState>('/api/reset', {}),
  export: (sign: boolean) => post<ExportResult>('/api/export', { sign }),
  installPlan: (target: string, root: string) =>
    post<InstallPlan>('/api/install/plan', { target, root }),
  install: (target: string, root: string, creds: Record<string, string>) =>
    post<InstallResult>('/api/install', { target, root, creds }),
  hubMcp: (query: string) => post<HubSearch<McpHubResult>>('/api/hub/mcp/search', { query }),
  hubSkills: (query: string) =>
    post<HubSearch<SkillHubResult>>('/api/hub/skills/search', { query }),
  addHubMcp: (result: McpHubResult) => post<StudioState>('/api/hub/mcp/add', { result }),
  addHubSkill: (url: string) => post<StudioState>('/api/hub/skill/add', { url }),
  hubIndexes: () => get<{ indexes: string[] }>('/api/hub/indexes'),
  setHubIndexes: (urls: string[]) => post<{ indexes: string[] }>('/api/hub/indexes', { urls }),
};
