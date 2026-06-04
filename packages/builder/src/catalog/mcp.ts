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
  {
    id: 'gbrain',
    name: 'GBrain (memory)',
    description:
      'Persistent, queryable memory — search/think over a local gbrain (by Garry Tan). Requires gbrain installed.',
    server: {
      id: 'gbrain',
      transport: 'stdio',
      command: 'gbrain',
      args: ['serve'],
      auth: { type: 'none' },
      tools: { include: 'all' },
      description:
        'GBrain memory MCP server (local). Install once: `bun install -g github:garrytan/gbrain`, then `gbrain init`.',
    },
  },
  {
    id: 'gbrain-remote',
    name: 'GBrain (remote)',
    description: 'Connect to a hosted gbrain over HTTP with a bearer token.',
    server: {
      id: 'gbrain-remote',
      transport: 'streamable-http',
      url: 'https://your-gbrain.example.com/mcp',
      auth: { type: 'bearer', credentialRef: 'gbrain_token' },
      tools: { include: 'all' },
      description: 'Hosted GBrain memory MCP server.',
    },
    credential: {
      ref: 'gbrain_token',
      label: 'GBrain access token',
      type: 'bearer',
      consumedBy: [],
      required: true,
      help: 'From your gbrain server: gbrain connect <url> --token <tok>.',
    },
  },
];
