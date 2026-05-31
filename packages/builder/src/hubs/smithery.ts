import type { CredentialRequirement } from '@uniqent/spec';
import type { CatalogSource, McpHubResult } from './types.js';
import { slugifyId } from './types.js';

const ENDPOINT = 'https://registry.smithery.ai/servers';
const CRED_REF = 'smithery_api_key';

interface SmitheryItem {
  qualifiedName?: string;
  displayName?: string;
  description?: string;
  useCount?: number;
  homepage?: string;
}
interface SmitheryResponse {
  servers?: SmitheryItem[];
}

/** Every Smithery server reaches its hosted endpoint with one shared Smithery API key. */
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

export function mapSmitheryItem(item: SmitheryItem): McpHubResult | null {
  if (!item.qualifiedName) return null;
  const id = slugifyId(item.qualifiedName);
  const credential = smitheryCredential(id);
  return {
    source: 'smithery',
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

export function mapSmitheryResponse(json: unknown): McpHubResult[] {
  const items = (json as SmitheryResponse)?.servers ?? [];
  const out: McpHubResult[] = [];
  for (const item of items) {
    const mapped = mapSmitheryItem(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function smitherySource(opts: { endpoint?: string } = {}): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  return {
    id: 'smithery',
    label: 'Smithery',
    async searchMcp(query: string, signal?: AbortSignal): Promise<McpHubResult[]> {
      const url = `${endpoint}?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`Smithery: ${res.status} ${res.statusText}`);
      return mapSmitheryResponse(await res.json());
    },
  };
}
