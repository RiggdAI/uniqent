import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeMcpConfig, parseMemoryMarkdown, memoryGraph } from '@uniqent/builder';
import { Bundle, isLikelySecretValue, scanForSecrets } from '@uniqent/core';

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

  // 13. Secret names are judged by their last word: PATH / AUTHOR_NAME / *_PATH are not secrets
  tc('secret-name-last-word', {
    mcpServers: {
      fs: {
        command: 'node',
        env: {
          PATH: '/usr/bin',
          AUTHOR_NAME: 'Ada',
          MEMORY_FILE_PATH: '/tmp/mem.json',
          TOKEN_URL: 'https://auth.example.com/token',
          xApiKey: 'short',
          DB_PASSWORD: 'hunter2',
        },
      },
    },
  });

  // 14. VS Code mcp.json `{ servers: { name: {...} } }` map, with `type` spelling the transport
  tc('vscode-servers-map', {
    servers: {
      events: { type: 'sse', url: 'https://mcp.example.com/events' },
      local: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
    },
  });

  // 15. Colliding ids get -2 / -3 (map keys that slugify alike, unnamed array entries)
  tc('colliding-map-ids', {
    mcpServers: {
      'My Server': { command: 'a' },
      'my-server': { command: 'b' },
      MY_SERVER: { command: 'c' },
    },
  });
  tc('colliding-array-ids', {
    servers: [{ command: 'a' }, { command: 'b' }, { id: 'mcp-server', command: 'c' }],
  });

  // 16. Secrets are lifted from canonical-shaped input too (placeholders kept as-is)
  tc('canonical-lifts-env-secrets', {
    id: 'gh',
    transport: 'stdio',
    command: 'npx',
    env: { GITHUB_TOKEN: 'plain', EXISTING: '${credentialRef:gh_existing}', LANG: 'en' },
    auth: { type: 'none' },
    extra: 'dropped like zod does',
  });

  // 17. A server with neither command nor url is reported, not invented
  tc('no-command-no-url', { mcpServers: { ghost: { args: ['x'] } } });

  return cases;
}

/**
 * Secret-scan parity cases for the Rust port of the core scanner (fixed, obviously fake values).
 * `values` pins isLikelySecretValue; `bundles` pins scanForSecrets findings (text files, plus
 * base64 for binary ones).
 */
export function buildSecretCases(): {
  values: Array<{ value: string; likely: boolean }>;
  bundles: Array<{
    name: string;
    files: Record<string, { text: string } | { base64: string }>;
    findings: Array<{ path: string; kind: string; snippet: string }>;
  }>;
} {
  const values = [
    'sk-abcdefghijklmnopqrstuvwxyz0123',
    'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
    'kJ8s0LkQ2mZ9rT4wX7bV1nC6pY3dF5gH8jL0aS2',
    '${credentialRef:foo_token}',
    'hello world',
    '',
    'sk-ant-api03-abcDEF123_-ghiJKL456mnoPQR789stuVWX',
    'sk-proj-EXAMPLEexample-EXAMPLE_example00',
    'github_pat_11EXAMPLE0123456789_abcdefghijklmnopqrstuvwxyz',
    'glpat-EXAMPLEexample00000',
    'AIzaEXAMPLEexampleEXAMPLEexample0000000',
    'sk_live_EXAMPLEEXAMPLEEXAMPLE00',
    'postgres://admin:Tr0ub4dor@db.example.com/app',
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    `API_KEY=${'0123456789abcdef'.repeat(2)}`,
    `token: ${'a1b2c3d4e5'.repeat(4)}`,
    `Authorization: Bearer ${'deadbeef'.repeat(8)}`,
    'apiKey = "123e4567-e89b-12d3-a456-426614174000"',
    'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    '${credentialRef:ghp_0123456789abcdefghijklmnopqrstuvwx}',
    '${credentialRef:x} sk-abcdefghijklmnopqrstuvwxyz0123',
    'postgres://app:${credentialRef:db_password}@db.example.com/app',
    'npx -y @modelcontextprotocol/server-github',
    'modelcontextprotocol/server-sequential-thinking',
    `sha512-${'Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv'.repeat(2)}==`,
    `ghcr.io/org/img@sha256:${'0123456789abcdef'.repeat(4)}`,
    'https://drive.google.com/file/d/1Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs/view',
    'https://docs.google.com/document/d/1Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv/edit',
    `https://mcp.zapier.com/api/mcp/s/${'Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs'.repeat(2)}/mcp`,
    'https://api.telegram.org/bot123456789:AAH' + 'Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs/getMe',
    'https://user@drive.google.com/file/d/1Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs/view',
    'https://api.example.com/cb?code=Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv&x=1',
    'postgres://app:$DB_PASSWORD@db.example.com/app',
    `<image href="data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'.repeat(4)}"/>`,
    `commit ${'0123456789abcdef'.repeat(2)}0a1b2c3d`,
    'value=Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv',
    'dataforseo_labs_google_competitors_domain DATAFORSEO_LABS_BULK_TRAFFIC_ESTIMATION',
    'xoxb-0123456789-abcdefghij',
    'AKIAIOSFODNN7EXAMPLE',
    'hooks.slack.com/services/TEXAMPLE0/BEXAMPLE0/EXAMPLEexampleEXAMPLE0',
    'discord.com/api/webhooks/123456/EXAMPLEexampleEXAMPLE0000',
  ].map((value) => ({ value, likely: isLikelySecretValue(value) }));

  const bundle = (
    name: string,
    files: Record<string, { text: string } | { base64: string }>,
  ): {
    name: string;
    files: Record<string, { text: string } | { base64: string }>;
    findings: Array<{ path: string; kind: string; snippet: string }>;
  } => {
    const b = Bundle.empty();
    for (const [path, f] of Object.entries(files)) {
      b.set(path, 'text' in f ? f.text : new Uint8Array(Buffer.from(f.base64, 'base64')));
    }
    return { name, files, findings: scanForSecrets(b) };
  };
  const bundles = [
    bundle('json-fields-and-keys', {
      'mcp/servers.json': {
        text: JSON.stringify({
          env: {
            GITHUB_TOKEN: 'a1b2c3d4e5'.repeat(4),
            HEROKU_API_KEY: '123e4567-e89b-12d3-a456-426614174000',
            publicKey: 'deadbeef'.repeat(8),
          },
        }),
      },
      'tools/tools.json': {
        text: JSON.stringify({ ghp_0123456789abcdefghijklmnopqrstuvwx: true }),
      },
    }),
    bundle('allowlists', {
      'uniqent.json': {
        text: JSON.stringify({ author: { name: 'x', pubkey: 'deadbeef'.repeat(8) } }),
      },
      'signature.json': {
        text: JSON.stringify({
          publicKey: 'deadbeef'.repeat(8),
          signature: 'cafebabe'.repeat(16),
          digest: 'deadbeef'.repeat(8),
        }),
      },
    }),
    bundle('jsonl-and-malformed', {
      'memory/facts.jsonl': {
        text: '{"id":"f1","text":"plain"}\n\n{"id":"f2","text":"key sk-abcdefghijklmnopqrstuvwxyz0123"}\nnot json AKIAIOSFODNN7EXAMPLE\n',
      },
    }),
    bundle('text-and-binary', {
      'avatar.svg': { text: '<svg><!-- ghp_0123456789abcdefghijklmnopqrstuvwx --></svg>' },
      'skills/x/img.png': {
        base64: Buffer.from([
          0x89,
          0x50,
          0x4e,
          0x47,
          0,
          ...Buffer.from(' AKIAIOSFODNN7EXAMPLE '),
        ]).toString('base64'),
      },
      'README.md': { text: '\ufeffclean readme' },
    }),
    bundle('non-utf8-text', {
      'skills/x/SKILL.md': {
        base64: Buffer.concat([
          Buffer.from('Caf'),
          Buffer.from([0xe9]),
          Buffer.from('\nAPI_TOKEN=Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs\n'),
        ]).toString('base64'),
      },
      'notes.md': { base64: Buffer.from([0xef, 0xbb, 0xbf, 0xff, 0x41]).toString('base64') },
    }),
  ];
  return { values, bundles };
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

  // 11. Markdown structure that is not memory: front matter, code fences, tables, rules
  memoryCases.push(
    memCase(
      'structure-skipped',
      [
        '---',
        'title: Notes',
        '---',
        'kept before the fence',
        '```ts',
        'const secret = "#notatag";',
        '```',
        '| a | b |',
        '|---|---|',
        '- - -',
        '***',
        '~~~',
        'unclosed fence swallows the rest',
      ].join('\r\n'),
    ),
  );

  // 12. Callouts, checkboxes, unicode tags, hex colors and markdown link targets
  memoryCases.push(
    memCase(
      'quotes-checkboxes-tags',
      [
        '> Decision: adopt [[Rust]] #perf',
        '> > nested quote #über-tag',
        '- [x] shipped the #日本語 docs',
        '- [ ] color #fff stays, see [docs](#setup) and (#paren-tag)',
        'x#notatag but #real_tag/sub',
      ].join('\n'),
    ),
  );

  // 13. A trailing run of tags is metadata (dropped from labels; hex colors survive)
  memoryCases.push(
    memCase(
      'trailing-tags',
      ['Cite sources inline #research. #citations #fff #format', 'only tags #a #b'].join('\n'),
    ),
  );

  return memoryCases;
}

export async function main(): Promise<void> {
  await mkdir(out, { recursive: true });

  const cases = buildNormalizeCases();
  await writeFile(join(out, 'normalize-cases.json'), JSON.stringify(cases, null, 2) + '\n');
  console.log(`fixtures/ports/normalize-cases.json written (${cases.length} cases)`);

  const secretCases = buildSecretCases();
  await writeFile(join(out, 'secret-cases.json'), JSON.stringify(secretCases, null, 2) + '\n');
  console.log(
    `fixtures/ports/secret-cases.json written (${secretCases.values.length} values, ${secretCases.bundles.length} bundles)`,
  );

  const memoryCases = buildMemoryCases();
  await writeFile(join(out, 'memory-cases.json'), JSON.stringify(memoryCases, null, 2) + '\n');
  console.log(`fixtures/ports/memory-cases.json written (${memoryCases.length} cases)`);
}

// Only run when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
