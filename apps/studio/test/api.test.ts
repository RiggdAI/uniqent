import { describe, it, expect } from 'vitest';
import { StudioSession } from '../src/server/session';
import { handleApi } from '../src/server/api';
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
