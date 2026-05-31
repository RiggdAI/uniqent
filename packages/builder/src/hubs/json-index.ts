import type { McpCatalogEntry } from '../catalog/mcp.js';
import type { CatalogSource, McpHubResult, SkillHubResult } from './types.js';

/**
 * A "hub is just a hosted JSON file" source — the same zero-service pattern as the bundle registry.
 * The index is `{ mcp?: McpCatalogEntry[], skills?: SkillHubResult[] }`; filtering is client-side.
 */
export interface JsonIndex {
  mcp?: McpCatalogEntry[];
  skills?: SkillHubResult[];
}

function matches(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

export function mapJsonIndexMcp(index: JsonIndex): McpHubResult[] {
  return (index.mcp ?? []).map((entry: McpCatalogEntry) => ({
    source: 'json-index',
    entry,
    credentials: entry.credential ? [entry.credential] : [],
  }));
}

export function jsonIndexSource(url: string, label = 'JSON index'): CatalogSource {
  async function load(signal?: AbortSignal): Promise<JsonIndex> {
    const res = await fetch(url, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`${label}: ${res.status} ${res.statusText}`);
    return (await res.json()) as JsonIndex;
  }
  return {
    id: 'json-index',
    label,
    async searchMcp(query, signal): Promise<McpHubResult[]> {
      const index = await load(signal);
      return mapJsonIndexMcp(index).filter((r) =>
        matches(query, r.entry.name, r.entry.description),
      );
    },
    async searchSkills(query, signal): Promise<SkillHubResult[]> {
      const index = await load(signal);
      return (index.skills ?? [])
        .map((s) => ({ ...s, source: 'json-index' }))
        .filter((s) => matches(query, s.name, s.description));
    },
  };
}
