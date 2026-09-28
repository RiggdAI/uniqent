import { z } from 'zod';
import type { SourceError } from './aggregate.js';
import { bodySnippet, hubFetch, type FetchFn } from './http.js';

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

/** The hosted memory hub used when no registry is configured. */
export const DEFAULT_MEMORY_REGISTRY = 'https://uniqent.ai';

const base = (b: string) => b.replace(/\/+$/, '');

const PackRow = z.object({
  slug: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  factCount: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
});
const SearchResponse = z.object({ packs: z.array(PackRow) });
const PackResponse = z.object({ facts: z.array(z.object({ kind: z.string(), text: z.string() })) });
const PublishResponse = z.object({
  ok: z.boolean().optional(),
  slug: z.string().optional(),
  factCount: z.number().int().nonnegative().optional(),
  url: z.string().optional(),
  persisted: z.boolean().optional(),
});

/** Search memory packs on a hosted registry. Never throws — a down hub is reported in `errors`. */
export async function searchMemoryHub(
  fetchFn: FetchFn,
  query: string,
  registry: string,
  signal: AbortSignal | undefined,
): Promise<MemoryHubSearch> {
  const url = `${base(registry)}/api/v1/memory?q=${encodeURIComponent(query)}`;
  try {
    const res = await hubFetch(fetchFn, 'memory-hub', url, {}, signal);
    if (!res.ok) throw new Error(`${res.status} from ${url}: ${await bodySnippet(res)}`);
    const parsed = SearchResponse.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`${url} returned an unexpected shape: ${parsed.error.message}`);
    }
    const results = parsed.data.packs.map((p) => ({
      source: 'memory-hub',
      slug: p.slug,
      name: p.name ?? p.slug,
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
 * scrubs personal-visibility facts before hosting. Throws with the status and body on failure.
 */
export async function publishMemoryPack(
  fetchFn: FetchFn,
  registry: string,
  token: string,
  pack: MemoryPackUpload,
  signal: AbortSignal | undefined,
): Promise<PublishResult> {
  if (!token) throw new Error('a publish token is required');
  if (!pack.slug || !pack.name) throw new Error('slug and name are required');
  const url = `${base(registry)}/api/v1/memory`;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(pack),
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`publish to ${url} failed: ${res.status} ${text.slice(0, 300)}`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new Error(`${url} returned non-JSON (${res.status}): ${text.slice(0, 300)}`, {
      cause: e,
    });
  }
  const parsed = PublishResponse.safeParse(body);
  if (!parsed.success) {
    throw new Error(`${url} returned an unexpected shape: ${parsed.error.message}`);
  }
  return {
    ok: parsed.data.ok ?? true,
    slug: parsed.data.slug ?? pack.slug,
    factCount: parsed.data.factCount ?? 0,
    url: parsed.data.url,
    persisted: parsed.data.persisted,
  };
}

/** Fetch a memory pack's facts from the registry. */
export async function fetchMemoryPack(
  fetchFn: FetchFn,
  registry: string,
  slug: string,
  signal: AbortSignal | undefined,
): Promise<Array<{ kind: string; text: string }>> {
  const url = `${base(registry)}/api/v1/memory/${encodeURIComponent(slug)}`;
  const res = await hubFetch(fetchFn, 'memory-hub', url, {}, signal);
  if (!res.ok)
    throw new Error(`memory pack ${slug}: ${res.status} from ${url}: ${await bodySnippet(res)}`);
  const parsed = PackResponse.safeParse(await res.json());
  if (!parsed.success) {
    throw new Error(
      `memory pack ${slug}: ${url} returned an unexpected shape: ${parsed.error.message}`,
    );
  }
  return parsed.data.facts;
}
