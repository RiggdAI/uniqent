/**
 * Credential env vars for OpenClaw. openclaw.json never holds a secret value: it references
 * `${UPPER_VAR}` (substituted at config load, src/config/env-substitution.ts), and the values
 * live in the state-dir `.env` (`$OPENCLAW_STATE_DIR/.env`, loaded by the gateway — see
 * docs.openclaw.ai/help/environment and src/config/state-dir-dotenv.ts).
 */

/** OpenClaw only substitutes uppercase names (`[A-Z_][A-Z0-9_]*`). */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const CREDENTIAL_REF = /\$\{credentialRef:([^}]+)\}/g;
const ENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
/** Values that dotenv reads back verbatim without quoting. */
const BARE_VALUE = /^[A-Za-z0-9_./:+=@,~%^-]+$/;

/** A credential ref cannot be expressed as an OpenClaw env var name. */
export class InvalidEnvNameError extends Error {
  constructor(
    readonly ref: string,
    readonly envVar: string,
  ) {
    super(
      `credential ref "${ref}" maps to env var "${envVar}", which OpenClaw cannot substitute ` +
        '(names must match [A-Z_][A-Z0-9_]*); rename the credential ref in the bundle',
    );
    this.name = 'InvalidEnvNameError';
  }
}

/** A credential value cannot be written to a dotenv file so that it reads back unchanged. */
export class EnvValueEncodingError extends Error {
  constructor(readonly envVar: string) {
    super(
      `cannot encode the value for ${envVar} in .env: it contains a newline or both quote ` +
        'characters; set it in the gateway environment instead',
    );
    this.name = 'EnvValueEncodingError';
  }
}

/** The env var holding credential `ref` (e.g. `github_pat` → `GITHUB_PAT`). */
export function envName(ref: string): string {
  const name = ref.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  if (!ENV_NAME.test(name)) throw new InvalidEnvNameError(ref, name);
  return name;
}

/** Rewrite every `${credentialRef:x}` placeholder into OpenClaw's `${X}` env reference. */
export function toEnvRefs(value: string): string {
  return value.replace(CREDENTIAL_REF, (_whole, ref: string) => `\${${envName(ref)}}`);
}

/** Credential refs used by `${credentialRef:x}` placeholders in `value`. */
export function credentialRefsIn(value: string): string[] {
  return [...value.matchAll(CREDENTIAL_REF)].map((m) => m[1] ?? '').filter(Boolean);
}

function encodeValue(envVar: string, value: string): string {
  if (BARE_VALUE.test(value)) return value;
  if (!value.includes('\n') && !value.includes("'")) return `'${value}'`;
  if (!value.includes('\n') && !value.includes('"') && !value.includes('\\')) return `"${value}"`;
  throw new EnvValueEncodingError(envVar);
}

/** A merged dotenv text plus the existing keys whose assignment it changed. */
export interface EnvMerge {
  content: string;
  replaced: string[];
}

/**
 * Merge `values` into an existing dotenv file's text: a line assigning one of the keys is
 * replaced in place (listed in `replaced` when that changes it), missing keys are appended,
 * every other line (comments, other vars) is kept.
 */
export function mergeEnvFile(
  existing: string | undefined,
  values: Record<string, string>,
): EnvMerge {
  const pending = new Map(Object.entries(values));
  const replaced: string[] = [];
  const lines =
    existing === undefined || existing === '' ? [] : existing.replace(/\n$/, '').split('\n');
  const merged = lines.map((line) => {
    const key = ENV_LINE.exec(line)?.[1];
    const value = key === undefined ? undefined : pending.get(key);
    if (key === undefined || value === undefined) return line;
    pending.delete(key);
    const next = `${key}=${encodeValue(key, value)}`;
    if (next !== line) replaced.push(key);
    return next;
  });
  for (const [key, value] of pending) merged.push(`${key}=${encodeValue(key, value)}`);
  return { content: merged.join('\n') + '\n', replaced };
}
