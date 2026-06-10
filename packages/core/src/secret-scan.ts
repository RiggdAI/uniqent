import { Bundle, PATHS } from './bundle.js';

export interface SecretFinding {
  path: string;
  kind: string;
  snippet: string;
}

const dec = new TextDecoder();

const PREFIX_PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'openai', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { kind: 'github-pat', re: /\bgh[posru]_[A-Za-z0-9]{30,}\b/ },
  { kind: 'slack', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'private-key', re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
];

const PLACEHOLDER_RE = /\$\{credentialRef:[^}]+\}/g;
const HIGH_ENTROPY_TOKEN = /[A-Za-z0-9+/_=-]{32,}/g;

// Image/binary assets (e.g. an avatar) aren't text — decoding their bytes as UTF-8 yields
// high-entropy garbage that would false-positive the entropy detector. Secrets only ever leak
// through the text surfaces (config, memory, manifest), which are still scanned.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/i;

/** Keys whose string values legitimately hold public key material; not secrets. */
const ALLOWLISTED_KEYS = new Set(['pubkey', 'publicKey']);

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
 * break into short word segments. We only entropy-flag when the longest unbroken run is long enough
 * to be a key. Known-format secrets (sk-, ghp_, …) are matched by PREFIX_PATTERNS regardless.
 */
function longestUnbrokenRun(token: string): number {
  return token.split(/[/_+=.-]/).reduce((max, seg) => Math.max(max, seg.length), 0);
}

/** Detect a secret in a single string value (placeholders already allowed). */
function detect(value: string): { kind: string; snippet: string } | null {
  const cleaned = value.replace(PLACEHOLDER_RE, '');
  for (const { kind, re } of PREFIX_PATTERNS) {
    const m = re.exec(cleaned);
    if (m) return { kind, snippet: snippet(m[0]) };
  }
  for (const m of cleaned.matchAll(HIGH_ENTROPY_TOKEN)) {
    if (longestUnbrokenRun(m[0]) < 20) continue; // identifier / path, not a secret-like run
    if (shannonEntropy(m[0]) >= 4.0) return { kind: 'high-entropy', snippet: snippet(m[0]) };
  }
  return null;
}

function walkJson(node: unknown, key: string | undefined, onString: (s: string) => void): void {
  if (typeof node === 'string') {
    if (key !== undefined && ALLOWLISTED_KEYS.has(key)) return;
    onString(node);
  } else if (Array.isArray(node)) {
    for (const item of node) walkJson(item, undefined, onString);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walkJson(v, k, onString);
  }
}

/** True when a single string value looks like a secret (known prefix or high entropy). */
export function isLikelySecretValue(value: string): boolean {
  return detect(value) !== null;
}

export function scanForSecrets(bundle: Bundle): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const [path, bytes] of bundle.entries()) {
    if (path === PATHS.signature) continue;
    if (BINARY_EXT.test(path)) continue; // binary asset — not a text surface
    const text = dec.decode(bytes);

    const record = (hit: { kind: string; snippet: string } | null) => {
      if (hit) findings.push({ path, kind: hit.kind, snippet: hit.snippet });
    };

    if (path.endsWith('.json') || path.endsWith('.jsonl')) {
      const lines = path.endsWith('.jsonl') ? text.split('\n') : [text];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          walkJson(JSON.parse(trimmed), undefined, (s) => record(detect(s)));
        } catch {
          record(detect(trimmed)); // malformed JSON: fall back to a text scan
        }
      }
    } else {
      record(detect(text));
    }
  }
  return findings;
}
