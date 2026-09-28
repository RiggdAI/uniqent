import type { Bundle, Issue } from '@uniqent/core';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;
// C0/C1 control characters (incl. newlines, so a string can't forge extra output lines) and
// bidi overrides that can visually reorder text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Make an untrusted (bundle- or network-derived) string safe to print on one terminal line. */
export function safe(s: string): string {
  return s.replace(ANSI, '').replace(CONTROL, ' ');
}

/** Quote an argv element when needed so what runs is visible exactly (e.g. `bash -c "curl|sh"`). */
function shellWord(s: string): string {
  const clean = safe(s);
  return /^[\w@%+=:,./-]+$/.test(clean) ? clean : JSON.stringify(clean);
}

/** One line per MCP server: exactly what command runs or which URL is contacted. */
export function describeMcpServers(bundle: Bundle): string[] {
  return bundle.mcpServers().map((s) => {
    const auth = s.auth.credentialRef ? `  auth=${s.auth.type}:${safe(s.auth.credentialRef)}` : '';
    if (s.transport === 'stdio') {
      const argv = [s.command ?? '', ...(s.args ?? [])].map(shellWord).join(' ');
      const env = Object.entries(s.env ?? {})
        .map(([k, v]) => `${safe(k)}=${shellWord(v)}`)
        .join(' ');
      return `${safe(s.id)}  runs: ${argv}${env ? `  env: ${env}` : ''}${auth}`;
    }
    return `${safe(s.id)}  ${s.transport} ${safe(s.url ?? '')}${auth}`;
  });
}

interface ZodIssueLike {
  path: Array<string | number>;
  message: string;
  code: string;
  expected?: unknown;
  received?: unknown;
}

function isZodIssueList(v: unknown): v is ZodIssueLike[] {
  return (
    Array.isArray(v) &&
    v.every(
      (i: unknown) =>
        typeof i === 'object' &&
        i !== null &&
        Array.isArray((i as ZodIssueLike).path) &&
        typeof (i as ZodIssueLike).message === 'string',
    )
  );
}

/**
 * Turn a core message of the form `<file> failed schema: <zod issues JSON>` into readable lines;
 * any other message is returned as-is. An unknown specVersion becomes an "upgrade uniqent" hint.
 */
export function readableMessage(message: string): string[] {
  const m = /^(.*?) failed schema: (\[[\s\S]*\])$/.exec(message);
  if (!m) return [safe(message)];
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[2] as string);
  } catch {
    return [safe(message)];
  }
  if (!isZodIssueList(parsed)) return [safe(message)];
  return parsed.map((i) => {
    const where = i.path.length > 0 ? i.path.join('.') : '(root)';
    if (where === 'specVersion' && i.code === 'invalid_literal')
      return `unsupported spec version ${safe(JSON.stringify(i.received))} (this uniqent reads ${safe(JSON.stringify(i.expected))}); upgrade uniqent`;
    return `${safe(m[1] as string)}: ${safe(where)}: ${safe(i.message)}`;
  });
}

/** Readable lines for validation issues (one per underlying problem). */
export function describeIssues(issues: Issue[]): string[] {
  return issues.flatMap((e) => readableMessage(e.message).map((line) => `${e.code}: ${line}`));
}
