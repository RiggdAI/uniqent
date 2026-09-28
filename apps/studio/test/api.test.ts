import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StudioSession } from '../src/server/session';
import { handleApi, handleRawApi, type ApiResponse } from '../src/server/api';
import type { StudioState, ExportResult } from '../src/server/session';

describe('handleApi', () => {
  it('drives a full build sequence to a valid, exportable brain', async () => {
    const s = new StudioSession();
    expect((await handleApi(s, 'GET', '/api/catalog', null)).status).toBe(200);
    await handleApi(s, 'POST', '/api/meta', {
      name: 'demo',
      displayName: 'Demo',
      description: 'd',
    });
    await handleApi(s, 'POST', '/api/persona', { persona: '# Persona\n' });
    await handleApi(s, 'POST', '/api/mcp/catalog/github', {});
    await handleApi(s, 'POST', '/api/skill/custom', {
      name: 'code-review',
      skillMd: '---\nname: code-review\n---\nReview.\n',
    });
    await handleApi(s, 'POST', '/api/memory', { text: 'prefers TS' });

    const state = await handleApi(s, 'GET', '/api/state', null);
    expect(state.status).toBe(200);
    expect((state.json as StudioState).validation.ok).toBe(true);

    const exp = await handleApi(s, 'POST', '/api/export', { sign: true });
    expect((exp.json as ExportResult).verified).toBe(true);
  });

  it('404s unknown routes and 400s bad catalog ids', async () => {
    const s = new StudioSession();
    expect((await handleApi(s, 'GET', '/api/nope', null)).status).toBe(404);
    expect((await handleApi(s, 'POST', '/api/mcp/catalog/nonexistent', {})).status).toBe(400);
  });
});

const PORT = 4173;
const own = { host: `localhost:${PORT}`, origin: `http://localhost:${PORT}` };
const json = { ...own, 'content-type': 'application/json' };
const raw = (s: StudioSession, headers: Record<string, string>, path: string, body: string) =>
  handleRawApi(s, { method: 'POST', path, headers, body }, PORT);
const post = (s: StudioSession, path: string, body: unknown) => handleApi(s, 'POST', path, body);
const errorOf = (r: ApiResponse) => (r.json as { error: string }).error;

describe('handleRawApi (request guard)', () => {
  it("accepts Studio's own page and rejects a page on another localhost port", async () => {
    const s = new StudioSession();
    expect((await raw(s, json, '/api/persona', '{"persona":"hi"}')).status).toBe(200);
    const foreign = { ...json, origin: 'http://localhost:5173' };
    expect((await raw(s, foreign, '/api/persona', '{"persona":"pwned"}')).status).toBe(403);
    expect(s.state().persona).toBe('hi');
  });

  it('refuses a "simple" text/plain POST (no CORS preflight) with 415', async () => {
    const s = new StudioSession();
    const r = await raw(s, { ...own, 'content-type': 'text/plain' }, '/api/skill/custom', '{}');
    expect(r.status).toBe(415);
  });

  it('answers malformed JSON with 400, not 500', async () => {
    const r = await raw(new StudioSession(), json, '/api/persona', '{"persona":');
    expect(r.status).toBe(400);
    expect(errorOf(r)).toMatch(/not valid JSON/);
  });
});

describe('handleApi input validation', () => {
  it('rejects invalid config with field errors and keeps the session usable', async () => {
    const s = new StudioSession();
    const r = await post(s, '/api/meta', { name: 'My Brain', version: 'v1' });
    expect(r.status).toBe(400);
    expect(Object.keys((r.json as { fields: Record<string, string> }).fields).sort()).toEqual([
      'name',
      'version',
    ]);
    const state = await handleApi(s, 'GET', '/api/state', null);
    expect(state.status).toBe(200);
    expect((state.json as StudioState).manifest.name).toBe('my-brain');
    expect((await post(s, '/api/meta', { name: 'my-agent', version: '1.0.0' })).status).toBe(200);
  });

  it.each([
    ['/api/memory/import', { items: [null] }],
    ['/api/memory', { text: 'x', importance: 5 }],
    ['/api/task/add', { name: 't', triggerType: 'sometimes' }],
    ['/api/task/add', { name: 't', triggerType: 'schedule', cron: 'every day at nine' }],
    ['/api/task/add', { name: 't', triggerType: 'schedule', cron: '0 25 * * *' }],
    ['/api/profile', { profile: 'abc' }],
    ['/api/install', { target: 'claude-code', root: 'relative/dir', creds: {} }],
    ['/api/install/plan', { target: 'claude-code', root: '.' }],
    ['/api/skill/custom', { name: 'My Skill!', skillMd: '' }],
    ['/api/skill/custom', { name: '..', skillMd: '' }],
    ['/api/mcp/remove', {}],
  ])('400s %s %j', async (path, body) => {
    const s = new StudioSession();
    const r = await post(s, path, body);
    expect(r.status).toBe(400);
    expect(errorOf(r)).toMatch(/^invalid request body/);
    expect((await handleApi(s, 'GET', '/api/state', null)).status).toBe(200);
  });

  it('accepts a valid cron schedule', async () => {
    const r = await post(new StudioSession(), '/api/task/add', {
      name: 'weekdays',
      triggerType: 'schedule',
      cron: '*/15 9-17 * * 1-5',
    });
    expect(r.status).toBe(200);
    expect((r.json as StudioState).manifest.components.tasks).toHaveLength(1);
  });
});

describe('skills from a URL', () => {
  const skills: Record<string, string> = {
    '/acme/one/HEAD/SKILL.md': '---\nname: pdf-tools\ndescription: d\n---\nPDFs.\n',
    '/acme/two/HEAD/SKILL.md': '---\nname: "code-review"\n---\nReview.\n',
    '/acme/three/HEAD/SKILL.md': '---\nname: pdf-tools\n---\nAnother PDF skill.\n',
    '/skills/triage/SKILL.md': '# Triage\nNo frontmatter.\n',
  };
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      const body = skills[req.url ?? ''];
      res.writeHead(body === undefined ? 404 : 200, { 'content-type': 'text/markdown' });
      res.end(body ?? 'not found');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('names URL imports from the SKILL.md frontmatter (not the HEAD ref) and 409s duplicates', async () => {
    const s = new StudioSession();
    const importUrl = (path: string) => post(s, '/api/skill/url', { url: `${base}${path}` });
    expect((await importUrl('/acme/one/HEAD/SKILL.md')).status).toBe(200);
    expect((await importUrl('/acme/two/HEAD/SKILL.md')).status).toBe(200);
    const dup = await importUrl('/acme/three/HEAD/SKILL.md');
    expect(dup.status).toBe(409);
    expect(errorOf(dup)).toMatch(/"pdf-tools" is already in this brain/);
    expect(s.state().manifest.components.skills.sort()).toEqual(['code-review', 'pdf-tools']);
  });

  it('adds a hub skill under the hub result name and 409s a taken name', async () => {
    const s = new StudioSession();
    const add = (path: string, name: string) =>
      post(s, '/api/hub/skill/add', { url: `${base}${path}`, name });
    expect((await add('/acme/one/HEAD/SKILL.md', 'one')).status).toBe(200);
    expect((await add('/acme/three/HEAD/SKILL.md', 'one')).status).toBe(409);
    expect((await add('/acme/two/HEAD/SKILL.md', 'Not A Slug')).status).toBe(400);
    expect(s.state().manifest.components.skills).toEqual(['one']);
  });

  it('falls back to the containing directory when SKILL.md has no frontmatter name', async () => {
    const s = new StudioSession();
    expect(
      (await post(s, '/api/skill/url', { url: `${base}/skills/triage/SKILL.md` })).status,
    ).toBe(200);
    expect(s.state().manifest.components.skills).toEqual(['triage']);
  });

  it('409s a custom skill whose name is taken', async () => {
    const s = new StudioSession();
    expect((await post(s, '/api/skill/custom', { name: 'notes', skillMd: '' })).status).toBe(200);
    expect((await post(s, '/api/skill/custom', { name: 'notes', skillMd: 'x' })).status).toBe(409);
  });
});

describe('credential cleanup', () => {
  it('drops a credential when the last server using it is removed', async () => {
    const s = new StudioSession();
    await post(s, '/api/mcp/catalog/github', {});
    expect(s.state().manifest.credentials.map((c) => c.ref)).toEqual(['github_pat']);
    const r = await post(s, '/api/mcp/remove', { id: 'github' });
    expect((r.json as StudioState).manifest.credentials).toEqual([]);
  });

  it('keeps a shared credential until its last consumer is gone', async () => {
    const s = new StudioSession();
    const server = (id: string) => ({
      id,
      transport: 'streamable-http',
      url: `https://${id}.example.com/mcp`,
      auth: { type: 'bearer', credentialRef: 'shared_token' },
    });
    await post(s, '/api/mcp/custom', server('a'));
    await post(s, '/api/mcp/custom', server('b'));
    await post(s, '/api/mcp/remove', { id: 'a' });
    expect(s.state().manifest.credentials).toEqual([
      expect.objectContaining({ ref: 'shared_token', consumedBy: ['mcp:b'] }),
    ]);
    await post(s, '/api/mcp/remove', { id: 'b' });
    expect(s.state().manifest.credentials).toEqual([]);
  });
});

describe('MCP bulk import', () => {
  it('gives unnamed raw servers distinct ids instead of overwriting one with the other', async () => {
    const s = new StudioSession();
    const r = await post(s, '/api/mcp/import', {
      servers: [
        { command: 'node', args: ['a.js'] },
        { command: 'node', args: ['b.js'] },
      ],
    });
    expect(r.status).toBe(200);
    expect((r.json as StudioState).manifest.components.mcp.sort()).toEqual([
      'mcp-server',
      'mcp-server-2',
    ]);
  });

  it('409s when two canonical servers share an id, adding neither', async () => {
    const s = new StudioSession();
    const server = { id: 'dup', transport: 'stdio', command: 'x', auth: { type: 'none' } };
    const r = await post(s, '/api/mcp/import', { servers: [server, { ...server, command: 'y' }] });
    expect(r.status).toBe(409);
    expect(s.state().manifest.components.mcp).toEqual([]);
  });
});
