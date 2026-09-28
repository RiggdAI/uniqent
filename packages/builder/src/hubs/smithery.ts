import { z } from 'zod';
import type { CredentialRequirement } from '@uniqent/spec';
import type { CatalogSource, McpHubResult, SkippedHubEntry, SourceResults } from './types.js';
import { slugifyId } from './types.js';
import { hubFetchJson, type FetchFn } from './http.js';

const ENDPOINT = 'https://registry.smithery.ai/servers';
const CRED_REF = 'smithery_api_key';
const SOURCE = 'smithery';

const SmitheryItem = z.object({
  qualifiedName: z.string().min(1),
  displayName: z.string().optional(),
  description: z.string().optional(),
  useCount: z.number().optional(),
  homepage: z.string().optional(),
  /** false = a local (stdio) server that is not reachable through the hosted gateway. */
  remote: z.boolean().optional(),
});
const SmitheryResponse = z.object({ servers: z.array(SmitheryItem) });
type SmitheryItem = z.infer<typeof SmitheryItem>;

/**
 * Every Smithery server is reached through the hosted gateway (server.smithery.ai), which rejects
 * any request without a Smithery API key — even for servers that need no config of their own.
 */
function smitheryCredential(id: string): CredentialRequirement {
  return {
    ref: CRED_REF,
    label: 'Smithery API key',
    type: 'apiKey',
    consumedBy: [`mcp:${id}`],
    required: true,
    help: 'Create at https://smithery.ai/account/api-keys',
  };
}

export function mapSmitheryItem(item: SmitheryItem): McpHubResult {
  const id = slugifyId(item.qualifiedName);
  const credential = smitheryCredential(id);
  return {
    source: SOURCE,
    entry: {
      id,
      name: item.displayName ?? item.qualifiedName,
      description: item.description ?? '',
      server: {
        id,
        transport: 'streamable-http',
        url: `https://server.smithery.ai/${item.qualifiedName}/mcp`,
        auth: { type: 'bearer', credentialRef: CRED_REF },
        tools: { include: 'all' },
        description: item.description ?? item.displayName ?? item.qualifiedName,
      },
      credential,
    },
    credentials: [credential],
    ...(item.homepage ? { homepage: item.homepage } : {}),
    ...(typeof item.useCount === 'number' ? { popularity: item.useCount } : {}),
  };
}

export function mapSmitheryResponse(json: unknown): SourceResults<McpHubResult> {
  const parsed = SmitheryResponse.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Smithery: unexpected response shape: ${parsed.error.message}`);
  }
  const results: McpHubResult[] = [];
  const skipped: SkippedHubEntry[] = [];
  for (const item of parsed.data.servers) {
    if (item.remote === false) {
      skipped.push({
        source: SOURCE,
        name: item.qualifiedName,
        reason: 'local-only (stdio) Smithery server; not reachable through the hosted gateway',
      });
      continue;
    }
    results.push(mapSmitheryItem(item));
  }
  return { results, skipped };
}

export function smitherySource(opts: { fetch: FetchFn; endpoint?: string }): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  return {
    id: SOURCE,
    label: 'Smithery',
    async searchMcp(query: string, signal?: AbortSignal): Promise<SourceResults<McpHubResult>> {
      const url = `${endpoint}?q=${encodeURIComponent(query)}`;
      return mapSmitheryResponse(await hubFetchJson(opts.fetch, 'Smithery', url, {}, signal));
    },
  };
}
