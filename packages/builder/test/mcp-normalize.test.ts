import { describe, it, expect } from 'vitest';
import { Bundle, scanForSecrets } from '@uniqent/core';
import { normalizeMcpConfig } from '../src/mcp/normalize.js';

describe('normalizeMcpConfig', () => {
  it('normalizes a Claude-Desktop mcpServers blob (stdio + secret env)', () => {
    const r = normalizeMcpConfig({
      mcpServers: {
        'brave-search': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          env: { BRAVE_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123', LANG: 'en' },
        },
      },
    });
    expect(r.servers).toHaveLength(1);
    const s = r.servers[0]!;
    expect(s.id).toBe('brave-search');
    expect(s.transport).toBe('stdio');
    expect(s.command).toBe('npx');
    expect(s.env!.BRAVE_API_KEY).toBe('${credentialRef:brave-search_brave_api_key}');
    expect(s.env!.LANG).toBe('en'); // non-secret kept inline
    const cred = r.credentials.find((c) => c.ref === 'brave-search_brave_api_key')!;
    expect(cred.consumedBy).toContain('mcp:brave-search');
    expect(cred.required).toBe(true);
  });

  it('lifts a secret env var by NAME even when value is not high-entropy', () => {
    const r = normalizeMcpConfig({
      mcpServers: { x: { command: 'run', env: { API_TOKEN: 'short' } } },
    });
    expect(r.servers[0]!.env!.API_TOKEN).toBe('${credentialRef:x_api_token}');
    expect(r.credentials).toHaveLength(1);
  });

  it('maps a remote server with a Bearer header to auth.bearer + a credential', () => {
    const r = normalizeMcpConfig({
      mcpServers: {
        linear: { url: 'https://mcp.linear.app/sse', headers: { Authorization: 'Bearer xyz' } },
      },
    });
    const s = r.servers[0]!;
    expect(s.transport).toBe('sse');
    expect(s.auth).toEqual({ type: 'bearer', credentialRef: 'linear_token' });
    expect(r.credentials[0]!.ref).toBe('linear_token');
  });

  it('maps a non-Authorization secret header to auth.header + headerName', () => {
    const r = normalizeMcpConfig({
      mcpServers: { svc: { url: 'https://api.x.com/mcp', headers: { 'X-API-Key': 'abc' } } },
    });
    const s = r.servers[0]!;
    expect(s.transport).toBe('streamable-http');
    expect(s.auth).toEqual({
      type: 'header',
      headerName: 'X-API-Key',
      credentialRef: 'svc_x_api_key',
    });
  });

  it('passes through an already-canonical McpServer', () => {
    const canonical = {
      id: 'gh',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'x'],
      auth: { type: 'none' },
      tools: { include: 'all' },
    };
    const r = normalizeMcpConfig(canonical);
    expect(r.servers[0]!.id).toBe('gh');
    expect(r.lossiness).toEqual([]);
  });

  it('lifts secrets from canonical-shaped input too, keeping existing refs', () => {
    const r = normalizeMcpConfig({
      id: 'svc',
      transport: 'stdio',
      command: 'svc-mcp',
      auth: { type: 'none' },
      env: {
        SVC_API_KEY: '3f9a8c2e7b1d4f6a9c0e2b4d6f8a1c3e5b7d9f0a',
        SVC_REGION: 'eu',
        GITHUB_TOKEN: '${credentialRef:github_pat}',
      },
    });
    const env = r.servers[0]!.env!;
    expect(env.SVC_API_KEY).toBe('${credentialRef:svc_svc_api_key}'); // literal hex key lifted
    expect(env.SVC_REGION).toBe('eu');
    expect(env.GITHUB_TOKEN).toBe('${credentialRef:github_pat}'); // existing ref untouched
    expect(r.credentials.map((c) => c.ref)).toEqual(['svc_svc_api_key']);
  });

  it('does not treat PATH-like or author names as secrets', () => {
    const r = normalizeMcpConfig({
      mcpServers: {
        mem: {
          command: 'npx',
          env: {
            PATH: '/usr/bin',
            AUTHOR_NAME: 'Ada',
            MEMORY_FILE_PATH: '/tmp/m.json',
            DB_PASSWORD: 'x',
          },
        },
      },
    });
    const env = r.servers[0]!.env!;
    expect([env.PATH, env.AUTHOR_NAME, env.MEMORY_FILE_PATH]).toEqual([
      '/usr/bin',
      'Ada',
      '/tmp/m.json',
    ]);
    expect(env.DB_PASSWORD).toBe('${credentialRef:mem_db_password}');
    expect(r.credentials.map((c) => c.ref)).toEqual(['mem_db_password']);
  });

  it('normalizes a VS Code mcp.json { servers: { name: {...} } } map', () => {
    const r = normalizeMcpConfig({
      servers: {
        fetch: { type: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
        docs: { type: 'sse', url: 'https://docs.example.com/events' },
      },
    });
    expect(r.servers.map((s) => [s.id, s.transport])).toEqual([
      ['fetch', 'stdio'],
      ['docs', 'sse'],
    ]);
  });

  it('gives unnamed servers in a list unique ids instead of overwriting', () => {
    const r = normalizeMcpConfig({
      servers: [{ command: 'a-mcp' }, { command: 'b-mcp' }, { url: 'https://c.example.com/mcp' }],
    });
    expect(r.servers.map((s) => s.id)).toEqual(['mcp-server', 'mcp-server-2', 'mcp-server-3']);
  });

  it('skips a server with neither command nor url instead of inventing npx', () => {
    const r = normalizeMcpConfig({ mcpServers: { broken: { args: ['x'] } } });
    expect(r.servers).toEqual([]);
    expect(r.lossiness[0]).toMatch(/broken.*neither a command nor a url/);
  });

  it('returns a lossiness note for an unrecognized shape, never throws', () => {
    const r = normalizeMcpConfig({ totally: 'unrelated' });
    expect(r.servers).toEqual([]);
    expect(r.lossiness.length).toBeGreaterThan(0);
  });

  it('a pasted blob with a RAW secret produces refs that pass the secret gate', () => {
    const r = normalizeMcpConfig({
      mcpServers: {
        x: { command: 'run', env: { OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123' } },
      },
    });
    const bundle = Bundle.empty();
    bundle.set('mcp/servers.json', JSON.stringify({ servers: r.servers }));
    expect(scanForSecrets(bundle)).toHaveLength(0); // secret became a ref → gate clean
  });
});
