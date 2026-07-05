import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeMcpConfig, parseMemoryMarkdown, memoryGraph } from '@uniqent/builder';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'ports');

interface PortCase {
  name: string;
  input: unknown;
  expected: unknown;
}

function buildNormalizeCases(): PortCase[] {
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

  return cases;
}

interface MemoryCase {
  name: string;
  markdown: string;
  parsed: ReturnType<typeof parseMemoryMarkdown>;
  graph: ReturnType<typeof memoryGraph>;
}

function memCase(name: string, markdown: string): MemoryCase {
  const parsed = parseMemoryMarkdown(markdown);
  const graphInput = parsed.map((it, i) => ({ id: `m${i}`, text: it.text, kind: it.kind }));
  const graph = memoryGraph(graphInput);
  return { name, markdown, parsed, graph };
}

function buildMemoryCases(): MemoryCase[] {
  const memoryCases: MemoryCase[] = [];

  // 1. Headings + bullets — headings are skipped, bullets become facts
  memoryCases.push(
    memCase(
      'headings-and-bullets',
      [
        '# Project Context',
        '- We decided to use Postgres for the main DB',
        '- The API uses REST not GraphQL',
        '## Technical Notes',
        '* TypeScript is the primary language',
      ].join('\n'),
    ),
  );

  // 2. kind: prefixes — explicit Decision/Preference/Milestone/Episodic/Fact prefixes
  memoryCases.push(
    memCase(
      'kind-prefixes',
      [
        'Decision: use [[Postgres]] over [[MySQL]] #db',
        'Preference: the user likes dark mode',
        'Milestone: shipped v1.0 to production',
        '[!episodic] fixed the auth bug on 2024-01-15',
        'Fact: the API rate limit is 1000 req/hr',
      ].join('\n'),
    ),
  );

  // 3. [[entity]] wikilinks — extracted + deduped
  memoryCases.push(
    memCase(
      'wikilink-entities',
      [
        'chose [[Postgres]] over [[MySQL]] for the main DB',
        '[[Postgres]] tuning notes: set max_connections to 200',
        'integrated [[Auth-Service|auth]] with [[Postgres]]',
      ].join('\n'),
    ),
  );

  // 4. #tags — extracted + deduped
  memoryCases.push(
    memCase(
      'hashtags',
      [
        'uses REST API #api #backend',
        'frontend is React #frontend #react',
        'CI runs on GitHub Actions #ci #backend',
      ].join('\n'),
    ),
  );

  // 5. Blank / whitespace input — produces empty array
  memoryCases.push(memCase('blank-input', ''));
  memoryCases.push(memCase('whitespace-only', '   \n\n   \n'));

  // 6. Mixed doc — headings, bullets, prefixes, wikilinks, tags combined (from TS test suite)
  memoryCases.push(
    memCase(
      'mixed-doc',
      [
        '# Context',
        '- Decision: we will use [[Postgres]] #db',
        '* [!preference] the user likes [[TypeScript]]',
        'The API hit a rate limit yesterday',
        '   ',
      ].join('\n'),
    ),
  );

  // 7. From TS test suite: dedup entities and tags
  memoryCases.push(
    memCase(
      'dedup-entities-and-tags',
      '[[Acme]] chose [[Postgres]] over [[Acme]] preferences #db #infra',
    ),
  );

  // 8. Numbered list items
  memoryCases.push(
    memCase(
      'numbered-list',
      [
        '1. First we set up [[Postgres]]',
        '2. Then we configured the ORM',
        '3. Milestone: DB migrations running',
      ].join('\n'),
    ),
  );

  // 9. Alias wikilinks [[Target|alias]]
  memoryCases.push(
    memCase(
      'alias-wikilinks',
      'see [[Auth-Service|the auth service]] for [[Postgres|our database]] #security #db',
    ),
  );

  // 10. Callout-style prefix [!kind]
  memoryCases.push(
    memCase(
      'callout-prefix',
      [
        '[!decision] use microservices architecture',
        '[!preference] prefer async patterns',
        '[!milestone] first beta released',
      ].join('\n'),
    ),
  );

  return memoryCases;
}

export async function main(): Promise<void> {
  await mkdir(out, { recursive: true });

  const cases = buildNormalizeCases();
  await writeFile(join(out, 'normalize-cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log(`fixtures/ports/normalize-cases.json written (${cases.length} cases)`);

  const memoryCases = buildMemoryCases();
  await writeFile(join(out, 'memory-cases.json'), JSON.stringify(memoryCases, null, 2) + '\n');
  console.log(`fixtures/ports/memory-cases.json written (${memoryCases.length} cases)`);
}

// Only run when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
