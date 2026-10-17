/** Env var name for a credential ref, e.g. github_pat → GITHUB_PAT. */
export function envName(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/** `KEY=` prefix of a dotenv assignment line (optionally `export`-ed), capturing the key. */
const ASSIGNMENT_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
/** Values python-dotenv reads verbatim when unquoted (no spaces, `#`, quotes or `$`). */
const BARE_VALUE_RE = /^[A-Za-z0-9_\-.:/+=@,~%]*$/;

/** Quote a value for python-dotenv (Hermes loads $HERMES_HOME/.env with it). */
function formatValue(value: string): string {
  if (BARE_VALUE_RE.test(value)) return value;
  // Single quotes are literal in python-dotenv: no escapes, no ${VAR} interpolation.
  if (!value.includes("'") && !value.includes('\n')) return `'${value}'`;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

/** A merged .env text plus the existing keys whose assignment it changed. */
export interface EnvMerge {
  content: string;
  replaced: string[];
}

/**
 * Merge `values` into an existing .env text. Every other line is kept; a line assigning one
 * of our keys gets its value replaced in place (its `export`/spacing prefix kept) and is listed
 * in `replaced` when that changes it; keys not yet present are appended. Re-merging the same
 * values yields byte-identical output and no `replaced` keys.
 */
export function mergeEnv(existing: string | undefined, values: Map<string, string>): EnvMerge {
  const lines =
    existing === undefined || existing === '' ? [] : existing.replace(/\n$/, '').split('\n');
  const seen = new Set<string>();
  const replaced = new Set<string>();
  const merged = lines.map((line) => {
    const m = ASSIGNMENT_RE.exec(line);
    const key = m?.[1];
    const value = key === undefined ? undefined : values.get(key);
    if (m === null || key === undefined || value === undefined) return line;
    seen.add(key);
    const next = `${m[0]}${formatValue(value)}`;
    if (next !== line) replaced.add(key);
    return next;
  });
  for (const [key, value] of values)
    if (!seen.has(key)) merged.push(`${key}=${formatValue(value)}`);
  return { content: merged.join('\n') + '\n', replaced: [...replaced] };
}
