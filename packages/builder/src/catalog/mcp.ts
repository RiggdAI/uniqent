import type { McpServer, CredentialRequirement } from '@uniqent/spec';

export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  server: McpServer;
  credential?: CredentialRequirement;
}

/** Curated, contributable set of common MCP servers. */
export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositories, issues, and pull requests via the GitHub MCP server.',
    server: {
      id: 'github',
      transport: 'streamable-http',
      url: 'https://api.githubcopilot.com/mcp/',
      auth: { type: 'bearer', credentialRef: 'github_pat' },
      tools: { include: 'all' },
      description: 'GitHub MCP server',
    },
    credential: {
      ref: 'github_pat',
      label: 'GitHub Personal Access Token',
      type: 'apiKey',
      consumedBy: [],
      required: true,
      help: 'Create at https://github.com/settings/tokens with the scopes you need.',
    },
  },
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write files in a local directory.',
    server: {
      id: 'filesystem',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${HOME}'],
      auth: { type: 'none' },
      tools: { include: 'all' },
      description: 'Local filesystem MCP server',
    },
  },
  {
    id: 'fetch',
    name: 'Web Fetch',
    description: 'Fetch and read web pages.',
    server: {
      id: 'fetch',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
      auth: { type: 'none' },
      tools: { include: 'all' },
      description: 'Web fetch MCP server',
    },
  },
];
