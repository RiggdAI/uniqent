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

export interface MemoryPackUpload {
  slug: string;
  name: string;
  description?: string;
  tags?: string[];
  facts: Array<{ kind: string; text: string; visibility?: string }>;
}
export interface PublishResult {
  ok: boolean;
  slug: string;
  factCount: number;
  url?: string;
  persisted?: boolean;
}

/**
 * Publish a memory pack to a hosted registry's `POST /api/v1/memory` (bearer-token gated).
 * `registry` is the SITE base (e.g. https://uniqent.ai), not an index.json URL. The server
 * scrubs personal-visibility facts before hosting. Throws with the server's message on failure.
 */
export async function publishMemoryPack(
  registry: string,
  token: string,
  pack: MemoryPackUpload,
  signal?: AbortSignal,
): Promise<PublishResult> {
  if (!token) throw new Error('a publish token is required');
  if (!pack.slug || !pack.name) throw new Error('slug and name are required');
  const res = await fetch(`${base(registry)}/api/v1/memory`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(pack),
    ...(signal ? { signal } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<PublishResult> & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return {
    ok: json.ok ?? true,
    slug: json.slug ?? pack.slug,
    factCount: json.factCount ?? 0,
    url: json.url,
    persisted: json.persisted,
  };
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
