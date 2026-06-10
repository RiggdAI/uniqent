import type { CatalogSource, McpHubResult } from './types.js';
import { slugifyId } from './types.js';
import { normalizeMcpConfig } from '../mcp/normalize.js';

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

/** Map a repo to a hub result with a best-effort `npx -y <repo>` guess (refined on add). */
export function mapGithubMcpRepo(repo: GithubRepo): McpHubResult | null {
  if (!repo.full_name) return null;
  const name = repo.full_name.split('/').pop() ?? repo.full_name;
  const id = slugifyId(name);
  return {
    source: 'github',
    entry: {
      id,
      name,
      description: repo.description ?? '',
      server: {
        id,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', name],
        auth: { type: 'none' },
        tools: { include: 'all' },
        description: repo.description ?? `${repo.full_name} (GitHub) — verify the run command`,
      },
    },
    credentials: [],
    ...(repo.html_url ? { homepage: repo.html_url } : {}),
    ...(typeof repo.stargazers_count === 'number' ? { popularity: repo.stargazers_count } : {}),
  };
}

export function mapGithubMcpResponse(json: unknown): McpHubResult[] {
  const items = (json as GithubSearchResponse)?.items ?? [];
  const out: McpHubResult[] = [];
  for (const item of items) {
    const m = mapGithubMcpRepo(item);
    if (m) out.push(m);
  }
  return out;
}

/** Pull the first fenced JSON block containing `mcpServers` out of a README and normalize it. */
export function extractMcpFromReadme(id: string, readme: string): McpHubResult | null {
  const blocks = [...readme.matchAll(/```(?:json[c]?)?\s*([\s\S]*?)```/g)].map((m) => m[1] ?? '');
  for (const block of blocks) {
    if (!/mcpServers/.test(block)) continue;
    try {
      const parsed = JSON.parse(block.trim());
      const r = normalizeMcpConfig(parsed);
      if (r.servers.length > 0) {
        const server = r.servers[0]!;
        return {
          source: 'github',
          entry: {
            id: server.id,
            name: server.id,
            description: server.description ?? '',
            server,
            ...(r.credentials[0] ? { credential: r.credentials[0] } : {}),
          },
          credentials: r.credentials,
        };
      }
    } catch {
      /* try the next block */
    }
  }
  return null;
}

export interface GithubMcpOptions {
  endpoint?: string;
  perPage?: number;
  /** A token raises the unauthenticated search rate limit. Falls back to GITHUB_TOKEN. */
  token?: string;
}

/**
 * Discover MCP servers as GitHub repos. Repo search returns candidates with a best-effort stdio
 * guess; the real run-config is refined from the repo README on add (`extractMcpFromReadme`).
 */
export function githubMcpSource(opts: GithubMcpOptions = {}): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  const perPage = opts.perPage ?? 20;
  return {
    id: 'github',
    label: 'GitHub',
    async searchMcp(query: string, signal?: AbortSignal): Promise<McpHubResult[]> {
      const q = `${query} mcp server`.trim();
      const url = `${endpoint}?q=${encodeURIComponent(q)}&per_page=${perPage}&sort=stars`;
      const token = opts.token ?? process.env.GITHUB_TOKEN;
      const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(url, { headers, ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`GitHub: ${res.status} ${res.statusText}`);
      return mapGithubMcpResponse(await res.json());
    },
  };
}
