import type { IncomingHttpHeaders } from 'node:http';
import type { z } from 'zod';
import { DuplicateMemoryIdError, InvalidBrainMetaError } from '@uniqent/builder';
import { DuplicateMcpServerError, DuplicateSkillError, type StudioSession } from './session.js';
import { hasJsonContentType, isLocalApiRequest } from './guard.js';
import {
  AvatarBody,
  CustomMcpBody,
  CustomSkillBody,
  ExportBody,
  HubIndexesBody,
  HubMcpAddBody,
  HubSkillAddBody,
  IdBody,
  InstallBody,
  InstallPlanBody,
  McpImportBody,
  MemoryBody,
  MemoryHubAddBody,
  MemoryHubPublishBody,
  MemoryHubSearchBody,
  MemoryImportBody,
  MetaBody,
  NameBody,
  PersonaBody,
  ProfileBody,
  QueryBody,
  ReadmeBody,
  TargetsBody,
  TaskBody,
  TextBody,
  UrlBody,
  VaultImportBody,
  VaultPreviewBody,
} from './schemas.js';

export interface ApiResponse {
  status: number;
  json: unknown;
}

/** One API request as the HTTP server received it, before any checks. */
export interface RawApiRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const ok = (json: unknown): ApiResponse => ({ status: 200, json });
const fail = (status: number, message: string): ApiResponse => ({
  status,
  json: { error: message },
});
/** A session error as a response: a duplicate is 409 Conflict, anything else `status`. */
const failWith = (e: unknown, status: number): ApiResponse =>
  fail(
    e instanceof DuplicateSkillError ||
      e instanceof DuplicateMemoryIdError ||
      e instanceof DuplicateMcpServerError
      ? 409
      : status,
    (e as Error).message,
  );

/** A request body that failed its route schema; carries a message per offending field. */
class RequestBodyError extends Error {
  readonly fields: Record<string, string>;
  constructor(route: string, issues: z.ZodIssue[]) {
    const fields: Record<string, string> = {};
    for (const i of issues) {
      const key = i.path.length > 0 ? i.path.join('.') : '(body)';
      fields[key] = fields[key] ? `${fields[key]}; ${i.message}` : i.message;
    }
    super(
      `invalid request body for ${route}: ${Object.entries(fields)
        .map(([k, m]) => `${k}: ${m}`)
        .join('; ')}`,
    );
    this.name = 'RequestBodyError';
    this.fields = fields;
  }
}

/**
 * Guard, parse and route one raw API request. Only Studio's own page may call the API (exact
 * Host + Origin), and every mutating call must be `application/json` (see guard.ts).
 */
export async function handleRawApi(
  session: StudioSession,
  req: RawApiRequest,
  port: number,
): Promise<ApiResponse> {
  if (!isLocalApiRequest(req.headers, port)) {
    return fail(403, 'forbidden: Uniqent Studio only serves requests from its own page');
  }
  let body: unknown = {};
  if (req.method !== 'GET') {
    if (!hasJsonContentType(req.headers)) {
      return fail(
        415,
        `${req.method} ${req.path} requires Content-Type: application/json (got ${req.headers['content-type'] ?? 'none'})`,
      );
    }
    if (req.body) {
      try {
        body = JSON.parse(req.body);
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
        return fail(400, `request body is not valid JSON: ${e.message}`);
      }
    }
  }
  return handleApi(session, req.method, req.path, body);
}

/** Pure request → session mapping; unit-testable without a socket. */
export async function handleApi(
  session: StudioSession,
  method: string,
  path: string,
  body: unknown,
): Promise<ApiResponse> {
  try {
    return await route(session, method, path, body);
  } catch (e) {
    if (!(e instanceof RequestBodyError)) throw e;
    return { status: 400, json: { error: e.message, fields: e.fields } };
  }
}

async function route(
  session: StudioSession,
  method: string,
  path: string,
  body: unknown,
): Promise<ApiResponse> {
  /** Validate the body against the route's schema; throws RequestBodyError (→ 400). */
  const parse = <S extends z.ZodTypeAny>(schema: S): z.output<S> => {
    const r = schema.safeParse(body ?? {});
    if (!r.success) throw new RequestBodyError(`${method} ${path}`, r.error.issues);
    return r.data as z.output<S>;
  };

  if (method === 'GET' && path === '/api/state') return ok(session.state());
  if (method === 'GET' && path === '/api/catalog') return ok(session.catalog());

  if (method === 'POST' && path === '/api/meta') {
    const meta = parse(MetaBody);
    try {
      session.setMeta(meta);
    } catch (e) {
      if (!(e instanceof InvalidBrainMetaError)) throw e;
      return { status: 400, json: { error: e.message, fields: { [e.field]: e.message } } };
    }
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/targets') {
    session.setTargets(parse(TargetsBody).targets);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/persona') {
    session.setPersona(parse(PersonaBody).persona);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/readme') {
    session.setReadme(parse(ReadmeBody).readme);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/avatar') {
    const { dataUrl } = parse(AvatarBody);
    try {
      session.setAvatar(dataUrl);
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
    const b = parse(MemoryBody);
    session.addFact({ text: b.text, importance: b.importance, visibility: b.visibility });
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/memory/import') {
    const b = parse(MemoryImportBody);
    if (b.items !== undefined) {
      try {
        session.importItems(b.items);
      } catch (e) {
        if (!(e instanceof DuplicateMemoryIdError)) throw e;
        return fail(409, e.message);
      }
    } else if (b.markdown !== undefined) {
      session.importMarkdown(b.markdown);
    } else if (b.text !== undefined) {
      session.importLines(b.text);
    }
    return ok(session.state());
  }
  if (method === 'GET' && path === '/api/memory/graph') {
    return ok(session.memoryGraph());
  }
  if (method === 'POST' && path === '/api/memory/preview') {
    return ok(session.previewMemoryImport(parse(TextBody).text));
  }
  if (method === 'POST' && path === '/api/memory/vault/preview') {
    const { dir } = parse(VaultPreviewBody);
    try {
      return ok(await session.previewVault(dir));
    } catch (e) {
      return fail(400, `cannot read vault: ${(e as Error).message}`);
    }
  }
  if (method === 'POST' && path === '/api/memory/vault/import') {
    const b = parse(VaultImportBody);
    try {
      const stats = await session.importVaultDir(b.dir, {
        persona: b.persona !== false,
        profile: b.profile !== false,
      });
      return ok({ state: session.state(), stats });
    } catch (e) {
      return fail(400, `cannot import vault: ${(e as Error).message}`);
    }
  }
  if (method === 'POST' && path === '/api/memory/hub/search') {
    const b = parse(MemoryHubSearchBody);
    return ok(await session.searchMemoryHub(b.query, b.registry));
  }
  if (method === 'POST' && path === '/api/memory/hub/publish') {
    const b = parse(MemoryHubPublishBody);
    try {
      const result = await session.publishMemoryPack(b.token, b.registry);
      return ok({ result });
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/memory/hub/add') {
    const b = parse(MemoryHubAddBody);
    try {
      await session.addMemoryPack(b.slug, b.registry);
      return ok(session.state());
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'GET' && path === '/api/profile') {
    return ok({ profile: session.getProfile() });
  }
  if (method === 'POST' && path === '/api/profile') {
    session.setProfile(parse(ProfileBody).profile);
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
    const b = parse(CustomSkillBody);
    try {
      session.addCustomSkill(b.name, b.skillMd);
      return ok(session.state());
    } catch (e) {
      return failWith(e, 400);
    }
  }

  if (method === 'POST' && path === '/api/skill/url') {
    const { url } = parse(UrlBody);
    try {
      await session.importSkillFromUrl(url);
      return ok(session.state());
    } catch (e) {
      return failWith(e, 400);
    }
  }

  if (method === 'POST' && path === '/api/mcp/custom') {
    const server = parse(CustomMcpBody);
    try {
      session.addCustomMcp(server);
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  if (method === 'POST' && path === '/api/mcp/import') {
    const { servers } = parse(McpImportBody);
    try {
      session.importMcpServers(servers);
      return ok(session.state());
    } catch (e) {
      return failWith(e, 400);
    }
  }

  if (method === 'POST' && path === '/api/mcp/paste') {
    return ok(session.previewPastedMcp(parse(TextBody).text));
  }

  if (method === 'POST' && path === '/api/mcp/paste/add') {
    const { text } = parse(TextBody);
    try {
      session.addPastedMcp(text);
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  if (method === 'POST' && path === '/api/mcp/remove') {
    session.removeMcp(parse(IdBody).id);
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/skill/remove') {
    session.removeSkill(parse(NameBody).name);
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
    session.removeChannel(parse(IdBody).id);
    return ok(session.state());
  }

  if (method === 'POST' && path === '/api/task/add') {
    session.addTask(parse(TaskBody));
    return ok(session.state());
  }
  if (method === 'POST' && path === '/api/task/remove') {
    session.removeTask(parse(IdBody).id);
    return ok(session.state());
  }

  if (method === 'POST' && path === '/api/export') {
    return ok(await session.export({ sign: parse(ExportBody).sign }));
  }

  if (method === 'POST' && path === '/api/install/plan') {
    const b = parse(InstallPlanBody);
    try {
      return ok(await session.installPlan(b.target, b.root));
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/install') {
    const b = parse(InstallBody);
    try {
      return ok(await session.install(b.target, b.root, b.creds));
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }

  if (method === 'GET' && path === '/api/hub/indexes') {
    return ok({ indexes: session.listHubIndexUrls() });
  }
  if (method === 'POST' && path === '/api/hub/indexes') {
    return ok({ indexes: session.setHubIndexUrls(parse(HubIndexesBody).urls) });
  }
  if (method === 'POST' && path === '/api/hub/mcp/search') {
    const { query } = parse(QueryBody);
    try {
      return ok(await session.searchHubMcp(query));
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/hub/skills/search') {
    const { query } = parse(QueryBody);
    try {
      return ok(await session.searchHubSkills(query));
    } catch (e) {
      return fail(502, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/hub/mcp/add') {
    const { result } = parse(HubMcpAddBody);
    try {
      session.addMcpHubResult(result);
      return ok(session.state());
    } catch (e) {
      return fail(400, (e as Error).message);
    }
  }
  if (method === 'POST' && path === '/api/hub/skill/add') {
    const { url, name } = parse(HubSkillAddBody);
    try {
      await session.importHubSkill(url, name);
      return ok(session.state());
    } catch (e) {
      return failWith(e, 400);
    }
  }

  return fail(404, `no route for ${method} ${path}`);
}
