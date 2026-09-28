import type { CatalogSource } from './types.js';
import type { FetchFn } from './http.js';
import { mcpRegistrySource } from './mcp-registry.js';
import { smitherySource } from './smithery.js';
import { githubSkillsSource } from './github-skills.js';
import { jsonIndexSource } from './json-index.js';

export interface McpHubOptions {
  /** Node's global fetch (CLI) or Tauri's plugin-http fetch (native Studio). */
  fetch: FetchFn;
  /** Extra JSON-index hub URLs to include (e.g. a team's own curated list). */
  jsonIndexUrls: string[];
}

export interface SkillHubOptions extends McpHubOptions {
  /** GitHub token raising the skill-search rate limit; undefined = unauthenticated (10 req/min). */
  githubToken: string | undefined;
}

const indexSources = (opts: McpHubOptions): CatalogSource[] =>
  opts.jsonIndexUrls.map((url) => jsonIndexSource({ fetch: opts.fetch, url, label: 'JSON index' }));

/** The standard MCP discovery sources: MCP Registry + Smithery (+ any JSON indexes). */
export function defaultMcpSources(opts: McpHubOptions): CatalogSource[] {
  return [
    mcpRegistrySource({ fetch: opts.fetch }),
    smitherySource({ fetch: opts.fetch }),
    ...indexSources(opts),
  ];
}

/** The standard skill discovery sources: GitHub repos (+ any JSON indexes). */
export function defaultSkillSources(opts: SkillHubOptions): CatalogSource[] {
  return [
    githubSkillsSource({ fetch: opts.fetch, token: opts.githubToken }),
    ...indexSources(opts),
  ];
}
