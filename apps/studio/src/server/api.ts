import type { StudioSession } from './session.js';
import type { BrainMeta } from '@uniqent/builder';

export interface ApiResponse {
  status: number;
  json: unknown;
}

const ok = (json: unknown): ApiResponse => ({ status: 200, json });
const fail = (status: number, message: string): ApiResponse => ({
  status,
  json: { error: message },
});

/** Pure request → session mapping; unit-testable without a socket. */
export async function handleApi(
  session: StudioSession,
  method: string,
  path: string,
  body: unknown,
): Promise<ApiResponse> {
  const b = (body ?? {}) as Record<string, unknown>;

  if (method === 'GET' && path === '/api/state') return ok(session.state());
  if (method === 'GET' && path === '/api/catalog') return ok(session.catalog());

  if (method === 'POST' && path === '/api/meta') {
    session.setMeta(b as Partial<BrainMeta>);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/targets') {
    session.setTargets(Array.isArray(b.targets) ? (b.targets as string[]) : []);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/persona') {
    session.setPersona(typeof b.persona === 'string' ? b.persona : '');
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/memory') {
    if (typeof b.text !== 'string' || b.text.length === 0)
      return fail(400, 'memory text is required');
    session.addFact({
      text: b.text,
      importance: typeof b.importance === 'number' ? b.importance : undefined,
      visibility: b.visibility === 'personal' ? 'personal' : undefined,
    });
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/reset') {
    session.reset();
    return ok(session.state());
  }

  const mcpMatch = /^\/api\/mcp\/catalog\/([^/]+)$/.exec(path);
  if (method === 'POST' && mcpMatch && mcpMatch[1]) {
    try {
      session.addMcpFromCatalog(decodeURIComponent(mcpMatch[1]));
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  const skillMatch = /^\/api\/skill\/catalog\/([^/]+)$/.exec(path);
  if (method === 'POST' && skillMatch && skillMatch[1]) {
    try {
      session.addSkillFromCatalog(decodeURIComponent(skillMatch[1]));
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  if (method === 'POST' && path === '/api/mcp/remove') {
    if (typeof b.id === 'string') session.removeMcp(b.id);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/skill/remove') {
    if (typeof b.name === 'string') session.removeSkill(b.name);
    return ok(session.state());
  }

  if (method === 'POST' && path === '/api/export') {
    return ok(await session.export({ sign: b.sign === true }));
  }

  return fail(404, `no route for ${method} ${path}`);
}
