import { z } from 'zod';
import type { CatalogSource, SkillHubResult, SourceResults } from './types.js';
import { HubHttpError, bodySnippet, hubFetch, type FetchFn } from './http.js';

const ENDPOINT = 'https://api.github.com/search/repositories';
const RAW_BASE = 'https://raw.githubusercontent.com';
const SOURCE = 'github';

const GithubRepo = z.object({
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  description: z.string().nullable(),
  stargazers_count: z.number(),
});
const GithubSearchResponse = z.object({ items: z.array(GithubRepo) });
type GithubRepo = z.infer<typeof GithubRepo>;

/** A repo whose root SKILL.md was fetched, so its location is verified. */
export interface VerifiedSkillRepo {
  repo: GithubRepo;
  skillUrl: string;
  skillMd: string;
}

/** Read a scalar `key:` from a SKILL.md YAML frontmatter block. */
function frontmatterField(skillMd: string, key: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)?.[1];
  if (!block) return undefined;
  const line = new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm').exec(block)?.[1];
  // A block scalar (`key: >` / `key: |`) is multi-line; not worth a YAML parser for a label.
  if (!line || /^[|>][-+]?$/.test(line)) return undefined;
  return line.replace(/^(['"])(.*)\1$/, '$2') || undefined;
}

/**
 * A verified root SKILL.md → skill pointer. The name comes from the frontmatter `name`, else the
 * directory holding SKILL.md (the repo, for a root SKILL.md).
 */
export function mapVerifiedSkill(v: VerifiedSkillRepo): SkillHubResult {
  const dirName = v.repo.full_name.split('/').pop() ?? v.repo.full_name;
  const description = frontmatterField(v.skillMd, 'description') ?? v.repo.description ?? '';
  return {
    source: SOURCE,
    name: frontmatterField(v.skillMd, 'name') ?? dirName,
    description,
    skillUrl: v.skillUrl,
    repo: v.repo.full_name,
    stars: v.repo.stargazers_count,
  };
}

export function parseGithubSearch(json: unknown): GithubRepo[] {
  const parsed = GithubSearchResponse.safeParse(json);
  if (!parsed.success) {
    throw new Error(`GitHub: unexpected search response shape: ${parsed.error.message}`);
  }
  return parsed.data.items;
}

/** Explain a GitHub error status, calling out the (unauthenticated 10/min) search rate limit. */
function githubHint(res: Response, hasToken: boolean): string {
  const limited = res.status === 429 || res.headers.get('x-ratelimit-remaining') === '0';
  if (res.status === 403 || res.status === 429) {
    const why = limited ? 'rate limit exceeded' : 'forbidden (possibly a secondary rate limit)';
    return hasToken
      ? `${why}; the GITHUB_TOKEN in use has hit its search limit, retry later`
      : `${why}; unauthenticated search allows 10 requests/min — set GITHUB_TOKEN to raise it`;
  }
  return '';
}

export interface GithubSkillsOptions {
  fetch: FetchFn;
  endpoint?: string;
  perPage?: number;
  /** A token raises the unauthenticated search rate limit (10/min); undefined = unauthenticated. */
  token: string | undefined;
}

/**
 * Discover skills as GitHub repos with a root SKILL.md. Repo search ("<query> SKILL.md") finds
 * candidates; each is kept only if its SKILL.md actually exists on the default branch (fetched
 * from raw.githubusercontent.com, which does not count against the API rate limit).
 */
export function githubSkillsSource(opts: GithubSkillsOptions): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  const perPage = opts.perPage ?? 20;
  return {
    id: SOURCE,
    label: 'GitHub skills',
    async searchSkills(
      query: string,
      signal?: AbortSignal,
    ): Promise<SourceResults<SkillHubResult>> {
      const q = `${query} SKILL.md`.trim();
      const url = `${endpoint}?q=${encodeURIComponent(q)}&per_page=${perPage}&sort=stars`;
      const token = opts.token;
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await hubFetch(opts.fetch, 'GitHub', url, headers, signal);
      if (!res.ok) {
        const hint = githubHint(res, !!token);
        throw new HubHttpError('GitHub', url, res.status, await bodySnippet(res), hint);
      }
      const repos = parseGithubSearch(await res.json());
      const verified = await Promise.all(
        repos.map((repo) => fetchRootSkill(opts.fetch, repo, signal)),
      );
      return {
        results: verified
          .filter((v): v is VerifiedSkillRepo => v !== null)
          .map((v) => mapVerifiedSkill(v)),
        skipped: [],
      };
    },
  };
}

/** Fetch a repo's root SKILL.md; null when it has none (404), throws on any other failure. */
async function fetchRootSkill(
  fetchFn: FetchFn,
  repo: GithubRepo,
  signal: AbortSignal | undefined,
): Promise<VerifiedSkillRepo | null> {
  const skillUrl = `${RAW_BASE}/${repo.full_name}/${repo.default_branch}/SKILL.md`;
  const res = await hubFetch(fetchFn, 'GitHub', skillUrl, {}, signal);
  if (res.status === 404) return null;
  if (!res.ok) throw new HubHttpError('GitHub', skillUrl, res.status, await bodySnippet(res), '');
  return { repo, skillUrl, skillMd: await res.text() };
}
