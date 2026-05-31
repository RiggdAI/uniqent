import type { CatalogSource } from './types.js';
import { mcpRegistrySource } from './mcp-registry.js';
import { smitherySource } from './smithery.js';
import { githubSkillsSource } from './github-skills.js';
import { jsonIndexSource } from './json-index.js';

export interface DefaultHubOptions {
  /** Extra JSON-index hub URLs to include (e.g. a team's own curated list). */
  jsonIndexUrls?: string[];
  /** GitHub token to raise the search rate limit. */
  githubToken?: string;
}

/** The standard MCP discovery sources: MCP Registry + Smithery (+ any JSON indexes). */
export function defaultMcpSources(opts: DefaultHubOptions = {}): CatalogSource[] {
  return [
    mcpRegistrySource(),
    smitherySource(),
    ...(opts.jsonIndexUrls ?? []).map((u) => jsonIndexSource(u)),
  ];
}

/** The standard skill discovery sources: GitHub repos (+ any JSON indexes). */
export function defaultSkillSources(opts: DefaultHubOptions = {}): CatalogSource[] {
  return [
    githubSkillsSource(opts.githubToken ? { token: opts.githubToken } : {}),
    ...(opts.jsonIndexUrls ?? []).map((u) => jsonIndexSource(u)),
  ];
}
