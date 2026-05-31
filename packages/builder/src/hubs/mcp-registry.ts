import type { CredentialRequirement, McpServer } from '@uniqent/spec';
import type { CatalogSource, McpHubResult } from './types.js';
import { slugifyId } from './types.js';

const ENDPOINT = 'https://registry.modelcontextprotocol.io/v0/servers';

/** Shapes we read from the registry response (everything optional — parse defensively). */
interface RegistryEnvVar {
  name: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
  default?: string;
}
interface RegistryPackage {
  registryType?: string;
  identifier?: string;
  runtimeHint?: string;
  transport?: { type?: string };
  runtimeArguments?: Array<{ value?: string }>;
  environmentVariables?: RegistryEnvVar[];
}
interface RegistryServer {
  name?: string;
  description?: string;
  title?: string;
  remotes?: Array<{ type?: string; url?: string }>;
  packages?: RegistryPackage[];
}
interface RegistryRow {
  server?: RegistryServer;
  _meta?: Record<string, { isLatest?: boolean }>;
}
interface RegistryResponse {
  servers?: RegistryRow[];
}

const RUNTIME_BY_REGISTRY: Record<string, string> = { npm: 'npx', pypi: 'uvx', oci: 'docker' };

function isLatest(row: RegistryRow): boolean {
  const meta = row._meta?.['io.modelcontextprotocol.registry/official'];
  // Only filter out rows explicitly marked stale; treat unknown as latest.
  return meta?.isLatest !== false;
}

/** Map one registry row to a normalized hub result, or null if it has no usable transport. */
export function mapRegistryServer(row: RegistryRow): McpHubResult | null {
  const s = row.server;
  if (!s?.name) return null;
  const id = slugifyId(s.name);
  const description = s.description ?? '';
  const credentials: CredentialRequirement[] = [];

  const remote = s.remotes?.find((r) => r.url);
  let server: McpServer;
  if (remote?.url) {
    server = {
      id,
      transport: remote.type === 'sse' ? 'sse' : 'streamable-http',
      url: remote.url,
      auth: { type: 'none' },
      tools: { include: 'all' },
      description: s.title ?? description,
    };
  } else {
    const pkg = s.packages?.[0];
    if (!pkg?.identifier) return null;
    const command =
      pkg.runtimeHint ?? RUNTIME_BY_REGISTRY[pkg.registryType ?? ''] ?? pkg.registryType ?? 'npx';
    const runtimeArgs = (pkg.runtimeArguments ?? [])
      .map((a) => a.value)
      .filter((v): v is string => typeof v === 'string');
    const args = [...runtimeArgs, pkg.identifier];

    const env: Record<string, string> = {};
    for (const v of pkg.environmentVariables ?? []) {
      if (!v.name) continue;
      if (v.isSecret) {
        const ref = `${id}_${v.name.toLowerCase()}`;
        env[v.name] = `\${credentialRef:${ref}}`;
        credentials.push({
          ref,
          label: v.description ?? v.name,
          type: 'apiKey',
          consumedBy: [`mcp:${id}`],
          required: v.isRequired ?? true,
          ...(v.description ? { help: v.description } : {}),
        });
      } else {
        env[v.name] = v.default ?? '';
      }
    }

    server = {
      id,
      transport: 'stdio',
      command,
      args,
      ...(Object.keys(env).length > 0 ? { env } : {}),
      auth: { type: 'none' },
      tools: { include: 'all' },
      description: s.title ?? description,
    };
  }

  return {
    source: 'mcp-registry',
    entry: {
      id,
      name: s.title ?? s.name,
      description,
      server,
      ...(credentials[0] ? { credential: credentials[0] } : {}),
    },
    credentials,
  };
}

/** Map a full registry response, dropping stale versions and unusable rows. */
export function mapRegistryResponse(json: unknown): McpHubResult[] {
  const rows = (json as RegistryResponse)?.servers ?? [];
  const out: McpHubResult[] = [];
  for (const row of rows) {
    if (!isLatest(row)) continue;
    const mapped = mapRegistryServer(row);
    if (mapped) out.push(mapped);
  }
  return out;
}

export interface McpRegistryOptions {
  endpoint?: string;
  limit?: number;
}

/** The official Model Context Protocol registry. No auth. */
export function mcpRegistrySource(opts: McpRegistryOptions = {}): CatalogSource {
  const endpoint = opts.endpoint ?? ENDPOINT;
  const limit = opts.limit ?? 30;
  return {
    id: 'mcp-registry',
    label: 'MCP Registry',
    async searchMcp(query: string, signal?: AbortSignal): Promise<McpHubResult[]> {
      const url = `${endpoint}?search=${encodeURIComponent(query)}&limit=${limit}`;
      const res = await fetch(url, signal ? { signal } : undefined);
      if (!res.ok) throw new Error(`MCP Registry: ${res.status} ${res.statusText}`);
      return mapRegistryResponse(await res.json());
    },
  };
}
