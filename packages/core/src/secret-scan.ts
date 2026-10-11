import { Bundle, PATHS } from './bundle.js';

export interface SecretFinding {
  path: string;
  kind: string;
  snippet: string;
}

type Hit = { kind: string; snippet: string };

/** Lenient: invalid UTF-8 bytes decode to U+FFFD, so mis-encoded text is still scanned as text. */
const utf8 = new TextDecoder();
// One char per byte, so known token formats are still found inside binary assets. (WHATWG maps
// 'latin1' to windows-1252; only bytes 0x80–0x9F differ from ISO-8859-1, and token formats are ASCII.)
const latin1 = new TextDecoder('latin1');

/** Known secret formats, matched anywhere (including inside URLs and binary files). */
const PREFIX_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'openai', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { kind: 'openai', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: 'github-pat', re: /\bgh[posru]_[A-Za-z0-9]{30,}\b/ },
  { kind: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { kind: 'gitlab-pat', re: /\bglpat-[A-Za-z0-9_-]{20,}/ },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}/ },
  { kind: 'stripe', re: /\b[rs]k_live_[A-Za-z0-9]{16,}/ },
  { kind: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'slack-webhook', re: /hooks\.slack\.com\/services\/[A-Za-z0-9_/-]{20,}/ },
  { kind: 'discord-webhook', re: /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{20,}/ },
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----/ },
  // scheme://user:password@host — a password that is an env/template reference ($X, {x}, <x>) is not a value.
  { kind: 'url-credentials', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@$<{]+@/i },
];

/**
 * A `${credentialRef:<name>}` placeholder is allowed only when <name> is slug-like; its name is
 * still scanned on its own (so a token can't hide as a ref name). Anything else is scanned raw.
 */
const PLACEHOLDER_RE = /\$\{credentialRef:([A-Za-z0-9][A-Za-z0-9_.-]*)\}/g;
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

/** Non-secret high-entropy surfaces removed before the entropy check (known formats still apply). */
const DATA_URI_RE = /data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+/gi;
const INTEGRITY_RE = /\bsha(?:1|256|384|512)[-:][A-Za-z0-9+/=]+/gi;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>()`]+/gi;
/** Hosts whose URL paths hold public document ids (random-looking, but not credentials). */
const PUBLIC_ID_HOSTS: ReadonlySet<string> = new Set(['drive.google.com', 'docs.google.com']);

/** Names (JSON keys, env vars, assignments) whose values are credentials. */
const SECRET_NAME_WORD =
  /^(?:keys?|apikey|tokens?|secrets?|passwords?|passwd|pwd|pat|auth|authorization|credentials?)$/;
const ASSIGNMENT_RE =
  /([A-Za-z_][A-Za-z0-9_.-]{0,63})["']?\s*[:=]\s*["']?((?:(?:Bearer|Basic|Token)\s+)?[A-Za-z0-9/+=_-]+)/g;
/** Credential-shaped values that are only suspicious next to a secret-ish name. */
const SECRET_SHAPED_VALUES: RegExp[] = [
  /^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  // AWS secret access key shape.
  /^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9/+]{40}$/,
];

/** JSON fields that legitimately hold public key material / signatures, per bundle file. */
const ALLOWLISTED_JSON_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [PATHS.signature, new Set(['publicKey', 'signature', 'digest'])],
  [PATHS.manifest, new Set(['author.pubkey'])],
]);

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

function snippet(match: string): string {
  return match.length <= 12 ? match : `${match.slice(0, 6)}…${match.slice(-4)}`;
}

/**
 * The longest run of a token with no identifier/path separators (`/ _ - + = .`). A real secret is a
 * long UNBROKEN random string (base64/hex/token), so its longest run is long; natural identifiers
 * and URL/file paths — `dataforseo_labs_google_competitors_domain`, `claude/skills/foo/SKILL.md` —
 * break into short word segments. Known-format secrets (sk-, ghp_, …) are matched by PREFIX_PATTERNS.
 */
function longestUnbrokenRun(token: string): string {
  return token
    .split(/[/_+=.-]/)
    .reduce((longest, seg) => (seg.length > longest.length ? seg : longest), '');
}

function isSecretName(name: string): boolean {
  if (/api[_-]?key/i.test(name)) return true;
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
    .some((word) => SECRET_NAME_WORD.test(word.toLowerCase()));
}

/** A credential-shaped value (hex/UUID/AWS secret) under a secret-ish name. */
function detectNamed(name: string, value: string): Hit | null {
  if (!isSecretName(name)) return null;
  const bare = value.trim().replace(/^(?:Bearer|Basic|Token)\s+/i, '');
  return SECRET_SHAPED_VALUES.some((re) => re.test(bare))
    ? { kind: 'named-secret', snippet: snippet(bare) }
    : null;
}

function detectKnownFormat(text: string): Hit | null {
  for (const { kind, re } of PREFIX_PATTERNS) {
    const m = re.exec(text);
    if (m) return { kind, snippet: snippet(m[0]) };
  }
  return null;
}

/**
 * A URL is scanned whole (secrets live in paths too: webhook/bot tokens), except a public-document
 * host's path, whose ids are not credentials; only its query/fragment is kept.
 */
function urlSecretSurface(url: string): string {
  const host = url.slice(url.indexOf('://') + 3).split(/[/?#:]/)[0] ?? '';
  if (!PUBLIC_ID_HOSTS.has(host.toLowerCase())) return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? ' ' : ` ${url.slice(cut + 1).replace(/[&#]/g, ' ')} `;
}

function detectHighEntropy(text: string): Hit | null {
  const surface = text
    .replace(DATA_URI_RE, ' ')
    .replace(INTEGRITY_RE, ' ')
    .replace(URL_RE, urlSecretSurface);
  for (const m of surface.matchAll(HIGH_ENTROPY_TOKEN)) {
    const run = longestUnbrokenRun(m[0]);
    if (run.length < 20) continue; // identifier / path, not a secret-like run
    if (/^(?:[a-z]+|[A-Z]+)$/.test(run)) continue; // a plain word (e.g. an npm scope), not random
    if (shannonEntropy(m[0]) >= 4.0) return { kind: 'high-entropy', snippet: snippet(m[0]) };
  }
  return null;
}

/** Detect a secret in text with placeholders already removed. */
function detectText(text: string): Hit | null {
  const known = detectKnownFormat(text);
  if (known) return known;
  for (const m of text.matchAll(ASSIGNMENT_RE)) {
    const hit = detectNamed(m[1] ?? '', m[2] ?? '');
    if (hit) return hit;
  }
  return detectHighEntropy(text);
}

/** Detect a secret in a single string value; slug-named credentialRef placeholders are allowed. */
function detect(value: string): Hit | null {
  for (const m of value.matchAll(PLACEHOLDER_RE)) {
    const hit = detectText(m[1] ?? '');
    if (hit) return hit;
  }
  return detectText(value.replace(PLACEHOLDER_RE, ''));
}

/** Visit every object key and string value with its dotted field path (array items add an index). */
function walkJson(
  node: unknown,
  fieldPath: string[],
  onString: (value: string, fieldPath: string[]) => void,
): void {
  if (typeof node === 'string') {
    onString(node, fieldPath);
  } else if (Array.isArray(node)) {
    node.forEach((item, i) => walkJson(item, [...fieldPath, String(i)], onString));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      onString(k, [...fieldPath, k, '<key>']);
      walkJson(v, [...fieldPath, k], onString);
    }
  }
}

function scanJson(path: string, json: unknown, record: (hit: Hit | null) => void): void {
  const allowlisted = ALLOWLISTED_JSON_FIELDS.get(path);
  walkJson(json, [], (value, fieldPath) => {
    if (allowlisted?.has(fieldPath.join('.'))) return;
    record(detect(value));
    const name = fieldPath[fieldPath.length - 1];
    if (name !== undefined && name !== '<key>') record(detectNamed(name, value));
  });
}

/** Content without NULs is scanned as text whatever its extension or encoding; else binary. */
function decodeText(bytes: Uint8Array): string | undefined {
  return bytes.includes(0) ? undefined : utf8.decode(bytes);
}

/** True when a single string value looks like a secret (known format, named credential, high entropy). */
export function isLikelySecretValue(value: string): boolean {
  return detect(value) !== null;
}

export function scanForSecrets(bundle: Bundle): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [path, bytes] of bundle.entries()) {
    const record = (hit: Hit | null): void => {
      if (hit) findings.push({ path, kind: hit.kind, snippet: hit.snippet });
    };

    const text = decodeText(bytes);
    if (text === undefined) {
      // Binary asset (e.g. an avatar): entropy is meaningless, but known formats can't hide in it.
      record(detectKnownFormat(latin1.decode(bytes)));
      continue;
    }

    if (path.endsWith('.json') || path.endsWith('.jsonl')) {
      const lines = path.endsWith('.jsonl') ? text.split('\n') : [text];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let json: unknown;
        try {
          json = JSON.parse(trimmed);
        } catch {
          record(detect(trimmed)); // malformed JSON: fall back to a text scan
          continue;
        }
        scanJson(path, json, record);
      }
    } else {
      record(detect(text));
    }
  }
  return findings;
}
