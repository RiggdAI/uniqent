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
  if (method === 'POST' && path === '/api/readme') {
    session.setReadme(typeof b.readme === 'string' ? b.readme : '');
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/avatar') {
    if (typeof b.dataUrl !== 'string') return fail(400, 'dataUrl is required');
    try {
      session.setAvatar(b.dataUrl);
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/avatar/remove') {
    session.clearAvatar();
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
    } else if (typeof b.markdown === 'string') {
      session.importMarkdown(b.markdown);
    } else if (typeof b.text === 'string') {
      session.importLines(b.text);
    }
    return ok(session.state());
  }
  if (method === 'GET' && path === '/api/memory/graph') {
    return ok(session.memoryGraph());
  }
  if (method === 'POST' && path === '/api/memory/preview') {
    return ok(session.previewMemoryImport(typeof b.text === 'string' ? b.text : ''));
  }
  if (method === 'POST' && path === '/api/memory/vault/preview') {
    if (typeof b.dir !== 'string' || !b.dir.trim())
      return fail(400, 'vault folder path is required');
    try {
      return ok(await session.previewVault(b.dir.trim()));
    } catch (e) {
      return fail(400, `cannot read vault: ${(e as Error).message}`);
    }
  }
  if (method === 'POST' && path === '/api/memory/vault/import') {
    if (typeof b.dir !== 'string' || !b.dir.trim())
      return fail(400, 'vault folder path is required');
    try {
      const stats = await session.importVaultDir(b.dir.trim(), {
        persona: b.persona !== false,
        profile: b.profile !== false,
      });
      return ok({ state: session.state(), stats });
    } catch (e) {
      return fail(400, `cannot import vault: ${(e as Error).message}`);
    }
  }
  if (method === 'POST' && path === '/api/memory/hub/search') {
    return ok(
      await session.searchMemoryHub(
        typeof b.query === 'string' ? b.query : '',
        typeof b.registry === 'string' ? b.registry : undefined,
      ),
    );
  }
  if (method === 'POST' && path === '/api/memory/hub/publish') {
    if (typeof b.token !== 'string' || !b.token) return fail(400, 'token is required');
    try {
      const result = await session.publishMemoryPack(
        b.token,
        typeof b.registry === 'string' ? b.registry : undefined,
      );
      return ok({ result });
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/memory/hub/add') {
    if (typeof b.slug !== 'string' || !b.slug) return fail(400, 'slug is required');
    try {
      await session.addMemoryPack(b.slug, typeof b.registry === 'string' ? b.registry : undefined);
      return ok(session.state());
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'GET' && path === '/api/profile') {
    return ok({ profile: session.getProfile() });
  }
  if (method === 'POST' && path === '/api/profile') {
    session.setProfile((b.profile ?? {}) as Record<string, unknown>);
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

  if (method === 'POST' && path === '/api/mcp/paste') {
    if (typeof b.text !== 'string') return fail(400, 'text is required');
    return ok(session.previewPastedMcp(b.text));
  }

  if (method === 'POST' && path === '/api/mcp/paste/add') {
    if (typeof b.text !== 'string') return fail(400, 'text is required');
    try {
      session.addPastedMcp(b.text);
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

  if (method === 'POST' && path === '/api/install/plan') {
    if (typeof b.target !== 'string' || typeof b.root !== 'string' || !b.root.trim()) {
      return fail(400, 'target and root are required');
    }
    try {
      return ok(await session.installPlan(b.target, b.root.trim()));
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/install') {
    if (typeof b.target !== 'string' || typeof b.root !== 'string' || !b.root.trim()) {
      return fail(400, 'target and root are required');
    }
    try {
      const creds = (b.creds ?? {}) as Record<string, string>;
      return ok(await session.install(b.target, b.root.trim(), creds));
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  if (method === 'GET' && path === '/api/hub/indexes') {
    return ok({ indexes: session.listHubIndexUrls() });
  }
  if (method === 'POST' && path === '/api/hub/indexes') {
    const urls = Array.isArray(b.urls) ? (b.urls as string[]) : [];
    return ok({ indexes: session.setHubIndexUrls(urls) });
  }
  if (method === 'POST' && path === '/api/hub/mcp/search') {
    try {
      return ok(await session.searchHubMcp(typeof b.query === 'string' ? b.query : ''));
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/hub/skills/search') {
    try {
      return ok(await session.searchHubSkills(typeof b.query === 'string' ? b.query : ''));
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/hub/mcp/add') {
    if (!b.result || typeof b.result !== 'object') return fail(400, 'result is required');
    try {
      session.addMcpHubResult(b.result as Parameters<StudioSession['addMcpHubResult']>[0]);
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/hub/skill/add') {
    if (typeof b.url !== 'string' || !b.url.trim()) return fail(400, 'url is required');
    try {
      await session.importSkillFromUrl(b.url.trim());
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  return fail(404, `no route for ${method} ${path}`);
}
