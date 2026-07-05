import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeMcpConfig } from '@uniqent/builder';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ports');
await mkdir(out, { recursive: true });

interface PortCase {
  name: string;
  input: unknown;
  expected: unknown;
}

const cases: PortCase[] = [];

function tc(name: string, input: unknown): void {
  cases.push({ name, input, expected: normalizeMcpConfig(input) });
}

// 1. Claude-Desktop mcpServers blob (stdio + secret env)
tc('claude-desktop-stdio-with-secret-env', {
  mcpServers: {
    'brave-search': {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123', LANG: 'en' },
    },
  },
});

// 2. Secret env var by NAME even when value is not high-entropy
tc('secret-env-by-name-low-entropy', {
  mcpServers: { x: { command: 'run', env: { API_TOKEN: 'short' } } },
});

// 3. Remote server with Bearer header → auth.bearer
tc('remote-bearer-header', {
  mcpServers: {
    linear: { url: 'https://mcp.linear.app/sse', headers: { Authorization: 'Bearer xyz' } },
  },
});

// 4. Non-Authorization secret header → auth.header
tc('remote-non-auth-secret-header', {
  mcpServers: { svc: { url: 'https://api.x.com/mcp', headers: { 'X-API-Key': 'abc' } } },
});

// 5. Already-canonical McpServer passthrough
tc('already-canonical-passthrough', {
  id: 'gh',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'x'],
  auth: { type: 'none' },
  tools: { include: 'all' },
});

// 6. Unrecognized shape → lossiness note, never throws
tc('unrecognized-shape', { totally: 'unrelated' });

// 7. Raw secret env produces refs that pass secret gate
tc('raw-secret-high-entropy', {
  mcpServers: {
    x: { command: 'run', env: { OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123' } },
  },
});

// 8. Bare server object (command without url — stdio path)
tc('bare-server-object', { command: 'python', args: ['-m', 'myserver'] });

// 9. servers array
tc('servers-array', {
  servers: [{ id: 'srv1', command: 'node', args: ['index.js'] }],
});

// 10. null input → lossiness (non-object)
tc('null-input', null);

// 11. Already-canonical with id+transport but missing required url (sse needs url) →
//     canonical check fails, falls through to unrecognized (no command, no url, no mcpServers)
tc('already-canonical-invalid-no-url', { id: 'x', transport: 'sse' });

// 12. Remote server with description field passthrough
tc('remote-with-description', {
  mcpServers: {
    myapi: {
      url: 'https://api.myservice.com/mcp',
      description: 'My API MCP server',
    },
  },
});

await writeFile(join(out, 'normalize-cases.json'), JSON.stringify(cases, null, 2) + '\n');

console.log(`fixtures/ports/normalize-cases.json written (${cases.length} cases)`);
