import type { CatalogSource, SkillHubResult } from './types.js';

const ENDPOINT = 'https://api.github.com/search/repositories';

interface GithubRepo {
  full_name?: string;
  html_url?: string;
  description?: string;
  stargazers_count?: number;
}
interface GithubSearchResponse {
  items?: GithubRepo[];
}

export function mapGithubRepo(repo: GithubRepo): SkillHubResult | null {
  if (!repo.full_name) return null;
  const name = repo.full_name.split('/').pop() ?? repo.full_name;
  return {
    source: 'github',
    name,
    description: repo.description ?? '',
    // Best-effort: most skill repos keep SKILL.md at the root. Import fails gracefully otherwise.
    skillUrl: `https://raw.githubusercontent.com/${repo.full_name}/HEAD/SKILL.md`,
    repo: repo.full_name,
    ...(typeof repo.stargazers_count === 'number' ? { stars: repo.stargazers_count } : {}),
  };
}

export function mapGithubResponse(json: unknown): SkillHubResult[] {
  const items = (json as GithubSearchResponse)?.items ?? [];
  const out: SkillHubResult[] = [];
  for (const item of items) {
    const mapped = mapGithubRepo(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

export interface GithubSkillsOptions {
  endpoint?: string;
  perPage?: number;
  /** A token raises the unauthenticated search rate limit (~10/min). Falls back to GITHUB_TOKEN. */
  token?: string;
}

/**
 * Discover skills as GitHub repos containing a SKILL.md. There is no mature skills-hub API, so this
 * is repo search ("<query> SKILL.md") + a guessed raw URL — honest, not a rich catalog.
 */
export function githubSkillsSource(opts: GithubSkillsOptions = {}): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  const perPage = opts.perPage ?? 20;
  return {
    id: 'github',
    label: 'GitHub skills',
    async searchSkills(query: string, signal?: AbortSignal): Promise<SkillHubResult[]> {
      const q = `${query} SKILL.md`.trim();
      const url = `${endpoint}?q=${encodeURIComponent(q)}&per_page=${perPage}&sort=stars`;
      const token = opts.token ?? process.env.GITHUB_TOKEN;
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`);
      return mapGithubResponse(await res.json());
    },
  };
}
