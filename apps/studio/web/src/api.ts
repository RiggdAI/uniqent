import type { StudioState, CatalogView, ExportResult } from './types';

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
  addMcp: (id: string) => post<StudioState>(`/api/mcp/catalog/${encodeURIComponent(id)}`, {}),
  addSkill: (name: string) =>
    post<StudioState>(`/api/skill/catalog/${encodeURIComponent(name)}`, {}),
  removeMcp: (id: string) => post<StudioState>('/api/mcp/remove', { id }),
  removeSkill: (name: string) => post<StudioState>('/api/skill/remove', { name }),
  reset: () => post<StudioState>('/api/reset', {}),
  export: (sign: boolean) => post<ExportResult>('/api/export', { sign }),
};
