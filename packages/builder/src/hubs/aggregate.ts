import type { CatalogSource, McpHubResult, SkillHubResult } from './types.js';

/** One source's outcome, so callers can surface "hub X is down" without failing the search. */
export interface SourceError {
  source: string;
  message: string;
}

export interface HubSearch<T> {
  results: T[];
  errors: SourceError[];
}

/**
 * Fan out an MCP search across sources. A source that lacks searchMcp is skipped; one that throws
 * is isolated into `errors` (the rest still return). Results are sorted by popularity desc.
 */
export async function searchMcpHubs(
  query: string,
  sources: CatalogSource[],
  signal?: AbortSignal,
): Promise<HubSearch<McpHubResult>> {
  const active = sources.filter((s) => typeof s.searchMcp === 'function');
  const settled = await Promise.allSettled(active.map((s) => s.searchMcp!(query, signal)));
  return collect(active, settled, (a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
}

/** Fan out a skill search across sources; same isolation, sorted by stars desc. */
export async function searchSkillHubs(
  query: string,
  sources: CatalogSource[],
  signal?: AbortSignal,
): Promise<HubSearch<SkillHubResult>> {
  const active = sources.filter((s) => typeof s.searchSkills === 'function');
  const settled = await Promise.allSettled(active.map((s) => s.searchSkills!(query, signal)));
  return collect(active, settled, (a, b) => (b.stars ?? 0) - (a.stars ?? 0));
}

function collect<T>(
  sources: CatalogSource[],
  settled: PromiseSettledResult<T[]>[],
  sort: (a: T, b: T) => number,
): HubSearch<T> {
  const results: T[] = [];
  const errors: SourceError[] = [];
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i];
    const source = sources[i];
    if (!outcome || !source) continue;
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
    } else {
      errors.push({
        source: source.id,
        message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
  }
  results.sort(sort);
  return { results, errors };
}
