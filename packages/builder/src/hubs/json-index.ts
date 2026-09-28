import { z } from 'zod';
import { CredentialRequirement, McpServer } from '@uniqent/spec';
import type { CatalogSource, McpHubResult, SkillHubResult, SourceResults } from './types.js';
import { hubFetchJson, type FetchFn } from './http.js';

/**
 * A "hub is just a hosted JSON file" source — the same zero-service pattern as the bundle registry.
 * The index is `{ mcp?: McpCatalogEntry[], skills?: SkillHubResult[] }` (validated on load);
 * filtering is client-side.
 */
export const JsonIndex = z.object({
  mcp: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string(),
        server: McpServer,
        credential: CredentialRequirement.optional(),
      }),
    )
    .optional(),
  skills: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string(),
        skillUrl: z.string().url().optional(),
        repo: z.string().optional(),
        stars: z.number().optional(),
      }),
    )
    .optional(),
});
export type JsonIndex = z.infer<typeof JsonIndex>;

function matches(query: string, ...fields: Array<string | undefined>): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

export function mapJsonIndexMcp(index: JsonIndex): McpHubResult[] {
  return (index.mcp ?? []).map((entry) => ({
    source: 'json-index',
    entry,
    credentials: entry.credential ? [entry.credential] : [],
  }));
}

export function jsonIndexSource(opts: {
  fetch: FetchFn;
  url: string;
  label: string;
}): CatalogSource {
  const { url, label } = opts;
  async function load(signal?: AbortSignal): Promise<JsonIndex> {
    const parsed = JsonIndex.safeParse(await hubFetchJson(opts.fetch, label, url, {}, signal));
    if (!parsed.success) {
      throw new Error(`${label}: ${url} is not a valid hub index: ${parsed.error.message}`);
    }
    return parsed.data;
  }
  return {
    id: 'json-index',
    label,
    async searchMcp(query, signal): Promise<SourceResults<McpHubResult>> {
      const index = await load(signal);
      return {
        results: mapJsonIndexMcp(index).filter((r) =>
          matches(query, r.entry.name, r.entry.description),
        ),
        skipped: [],
      };
    },
    async searchSkills(query, signal): Promise<SourceResults<SkillHubResult>> {
      const index = await load(signal);
      return {
        results: (index.skills ?? [])
          .map((s) => ({ ...s, source: 'json-index' }))
          .filter((s) => matches(query, s.name, s.description)),
        skipped: [],
      };
    },
  };
}
