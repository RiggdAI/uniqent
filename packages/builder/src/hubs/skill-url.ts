import { HubHttpError, bodySnippet, hubFetch, type FetchFn } from './http.js';

/** The `name:` declared in a SKILL.md YAML frontmatter block, if any. */
function frontmatterName(skillMd: string): string | undefined {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skillMd)?.[1];
  const line = block?.split(/\r?\n/).find((l) => /^name\s*:/.test(l));
  const value = line
    ?.replace(/^name\s*:\s*/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');
  return value ? value : undefined;
}

/**
 * The directory holding a SKILL.md URL (or the stem of a `<name>.md` URL). GitHub URLs carry an
 * `<owner>/<repo>/<ref>` prefix (`…/blob/<ref>` on github.com) whose ref segment (`HEAD`, a branch)
 * is never a skill name; a SKILL.md at the repo root is named after the repo.
 */
function skillDirFromUrl(url: URL): string | undefined {
  const parts = url.pathname.split('/').filter(Boolean);
  const file = parts.pop() ?? '';
  if (!/^skill\.md$/i.test(file)) return file.replace(/\.md$/i, '') || undefined;
  const refEnd =
    url.hostname === 'raw.githubusercontent.com' ? 3 : url.hostname === 'github.com' ? 4 : 0;
  const dirs = parts.slice(refEnd);
  return dirs[dirs.length - 1] ?? (refEnd > 0 ? parts[1] : undefined);
}

/** Name a fetched skill: its SKILL.md frontmatter `name`, else the directory it lives in. */
export function skillNameFor(url: string, skillMd: string): string {
  const name = frontmatterName(skillMd) ?? skillDirFromUrl(new URL(url));
  if (!name) {
    throw new Error(
      `cannot name the skill from ${url}: its SKILL.md has no frontmatter "name:" and the URL has no skill directory`,
    );
  }
  return name;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Download a SKILL.md. Requires https (plain http only to loopback, for local development).
 * Throws with the URL and status on any failure.
 */
export async function fetchSkillMd(
  fetchFn: FetchFn,
  url: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const parsed = new URL(url);
  const loopbackHttp = parsed.protocol === 'http:' && LOOPBACK.has(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopbackHttp) {
    throw new Error(`skill URL must use https:// (http only for localhost), got ${url}`);
  }
  const res = await hubFetch(fetchFn, 'skill', url, {}, signal);
  if (!res.ok) throw new HubHttpError('skill', url, res.status, await bodySnippet(res), '');
  return res.text();
}
