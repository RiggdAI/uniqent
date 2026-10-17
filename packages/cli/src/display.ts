import type { Issue } from '@uniqent/core';
import { safe, describeMcpServers } from '@uniqent/builder';

export { safe, describeMcpServers };

interface ZodIssueLike {
  path: Array<string | number>;
  message: string;
  code: string;
  /** Zod 4 `invalid_value`: the allowed values. */
  values?: unknown[];
  /** The offending value (core parses the manifest with `reportInput`). */
  input?: unknown;
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
    if (where === 'specVersion' && i.code === 'invalid_value' && i.values)
      return `unsupported spec version ${safe(JSON.stringify(i.input))} (this uniqent reads ${safe(i.values.map((v) => JSON.stringify(v)).join(' or '))}); upgrade uniqent`;
    return `${safe(m[1] as string)}: ${safe(where)}: ${safe(i.message)}`;
  });
}

/** Readable lines for validation issues (one per underlying problem). */
export function describeIssues(issues: Issue[]): string[] {
  return issues.flatMap((e) => readableMessage(e.message).map((line) => `${e.code}: ${line}`));
}
