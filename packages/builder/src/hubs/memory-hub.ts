import type { SourceError } from './aggregate.js';

/**
 * The memory hub: pull shareable memory packs from a hosted registry (uniqent.ai) into a brain.
 * The registry exposes `GET /api/v1/memory?q=` (search) and `GET /api/v1/memory/:slug` (facts).
 * Optional convenience, like every hub — the base URL is configurable, never required.
 */
export interface MemoryPackResult {
  source: string;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  factCount: number;
  url: string;
}
export interface MemoryHubSearch {
  results: MemoryPackResult[];
  errors: SourceError[];
}

const base = (b: string) => b.replace(/\/+$/, '');

/** Search memory packs on a hosted registry. Never throws — a down hub is reported in `errors`. */
export async function searchMemoryHub(
  query: string,
  registry: string,
  signal?: AbortSignal,
): Promise<MemoryHubSearch> {
  try {
    const url = `${base(registry)}/api/v1/memory?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, signal ? { signal } : undefined);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = (await res.json()) as { packs?: Array<Partial<MemoryPackResult>> };
    const results = (json.packs ?? []).map((p) => ({
      source: 'memory-hub',
      slug: p.slug ?? '',
      name: p.name ?? p.slug ?? '',
      description: p.description ?? '',
      tags: p.tags ?? [],
      factCount: p.factCount ?? 0,
      url: p.url ?? '',
    }));
    return { results, errors: [] };
  } catch (e) {
    return { results: [], errors: [{ source: 'memory-hub', message: (e as Error).message }] };
  }
}

/** Fetch a memory pack's facts from the registry. */
export async function fetchMemoryPack(
  registry: string,
  slug: string,
  signal?: AbortSignal,
): Promise<Array<{ kind: string; text: string }>> {
  const url = `${base(registry)}/api/v1/memory/${encodeURIComponent(slug)}`;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`memory pack ${slug}: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { facts?: Array<{ kind: string; text: string }> };
  return json.facts ?? [];
}
