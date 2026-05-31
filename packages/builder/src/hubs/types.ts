import type { CredentialRequirement } from '@uniqent/spec';
import type { McpCatalogEntry } from '../catalog/mcp.js';

/** A discovered MCP server, normalized to the builder's catalog-entry shape. */
export interface McpHubResult {
  /** Which source produced this, e.g. "mcp-registry" | "smithery" | "json-index". */
  source: string;
  /** Ready to add via the same path as a custom MCP server. */
  entry: McpCatalogEntry;
  /**
   * Every credential the server needs (remote bearer + each secret env var). Authoritative for
   * adding — `entry.credential` holds only the first, for simple display. Each has consumedBy
   * preset to `["mcp:<id>"]` because env-placeholder refs are not auto-linked by the builder.
   */
  credentials: CredentialRequirement[];
  homepage?: string;
  /** A hub-provided popularity signal (useCount/score) when available, for ranking. */
  popularity?: number;
}

/** Add an MCP hub result to a brain: the server + every credential it declares. */
export function installMcpHubResult(
  brain: { addMcpServer(s: unknown): void; addCredential(c: unknown): void },
  result: McpHubResult,
): void {
  brain.addMcpServer(result.entry.server);
  for (const cred of result.credentials) brain.addCredential(cred);
}

/** A discovered skill — a pointer to import, not embedded content. */
export interface SkillHubResult {
  /** "github" | "json-index". */
  source: string;
  name: string;
  description: string;
  /** Raw SKILL.md URL to import (may be a best-effort guess for GitHub repos). */
  skillUrl?: string;
  repo?: string;
  stars?: number;
}

/**
 * A pluggable discovery source. A source implements one or both search methods; the aggregator
 * calls only the ones present. Implementations must throw on failure (the aggregator isolates it).
 */
export interface CatalogSource {
  id: string;
  label: string;
  searchMcp?(query: string, signal?: AbortSignal): Promise<McpHubResult[]>;
  searchSkills?(query: string, signal?: AbortSignal): Promise<SkillHubResult[]>;
}

/** Slugify a hub-provided server name into a valid, stable node id. */
export function slugifyId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'mcp-server';
}
