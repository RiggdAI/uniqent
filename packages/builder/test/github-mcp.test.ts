import { describe, it, expect } from 'vitest';
import { mapGithubMcpRepo, extractMcpFromReadme } from '../src/hubs/github-mcp.js';

const FIXTURE = {
  items: [
    {
      full_name: 'acme/cool-mcp',
      html_url: 'https://github.com/acme/cool-mcp',
      description: 'A cool MCP server',
      stargazers_count: 42,
    },
    { full_name: 'no/name-stripped' },
  ],
};

describe('github-mcp source', () => {
  it('maps repos to McpHubResult with a best-effort stdio guess', () => {
    const results = FIXTURE.items.map(mapGithubMcpRepo).filter(Boolean);
    expect(results).toHaveLength(2);
    const r = results[0]!;
    expect(r.source).toBe('github');
    expect(r.entry.id).toBe('cool-mcp');
    expect(r.entry.server.transport).toBe('stdio');
    expect(r.popularity).toBe(42);
  });

  it('extracts a real mcpServers block from a README via the normalizer', () => {
    const readme = [
      '# Cool MCP',
      'Install:',
      '```json',
      '{ "mcpServers": { "cool": { "command": "npx", "args": ["-y", "cool-mcp"],',
      '  "env": { "COOL_API_KEY": "sk-abcdefghijklmnopqrstuvwxyz0123" } } } }',
      '```',
    ].join('\n');
    const r = extractMcpFromReadme('cool-mcp', readme);
    expect(r).not.toBeNull();
    expect(r!.entry.server.command).toBe('npx');
    expect(r!.credentials.some((c) => c.ref.includes('api_key'))).toBe(true);
  });

  it('returns null when the README has no config block', () => {
    expect(extractMcpFromReadme('x', '# Just prose, no code')).toBeNull();
  });
});
