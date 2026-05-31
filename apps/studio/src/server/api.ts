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
  if (method === 'POST' && path === '/api/memory/import') {
    if (Array.isArray(b.items)) {
      session.importItems(b.items as Array<Record<string, unknown>>);
    } else if (typeof b.text === 'string') {
      session.importLines(b.text);
    }
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

  if (method === 'POST' && path === '/api/skill/custom') {
    if (typeof b.name !== 'string' || !b.name.trim()) return fail(400, 'skill name is required');
    session.addCustomSkill(b.name.trim(), typeof b.skillMd === 'string' ? b.skillMd : '');
    return ok(session.state());
  }

  if (method === 'POST' && path === '/api/skill/url') {
    if (typeof b.url !== 'string' || !b.url.trim()) return fail(400, 'url is required');
    try {
      await session.importSkillFromUrl(b.url.trim());
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  if (method === 'POST' && path === '/api/mcp/custom') {
    try {
      session.addCustomMcp(b);
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  if (method === 'POST' && path === '/api/mcp/import') {
    if (!Array.isArray(b.servers)) return fail(400, 'servers[] is required');
    try {
      session.importMcpServers(b.servers as Array<Record<string, unknown>>);
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

  const chanMatch = /^\/api\/channel\/catalog\/([^/]+)$/.exec(path);
  if (method === 'POST' && chanMatch && chanMatch[1]) {
    try {
      session.addChannelFromCatalog(decodeURIComponent(chanMatch[1]));
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/channel/remove') {
    if (typeof b.id === 'string') session.removeChannel(b.id);
    return ok(session.state());
  }

  if (method === 'POST' && path === '/api/task/add') {
    session.addTask(b as Parameters<StudioSession['addTask']>[0]);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/task/remove') {
    if (typeof b.id === 'string') session.removeTask(b.id);
    return ok(session.state());
  }

  if (method === 'POST' && path === '/api/export') {
    return ok(await session.export({ sign: b.sign === true }));
  }

  return fail(404, `no route for ${method} ${path}`);
}
