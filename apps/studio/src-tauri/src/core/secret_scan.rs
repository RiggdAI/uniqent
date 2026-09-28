//! Port of packages/core/src/secret-scan.ts — the fail-closed secret gate.
//!
//! Mirrors every TS rule: known-format patterns (PREFIX_PATTERNS), credential-shaped values under
//! secret-ish names (detectNamed / ASSIGNMENT_RE), and the high-entropy check with its non-secret
//! surfaces (data URIs, SRI hashes, URL paths) removed. `${credentialRef:<slug>}` placeholders are
//! allowed, but their names are scanned too. UTF-8 files are scanned as text whatever their
//! extension (JSON/JSONL by field, with per-file public-key allowlists); anything else gets a
//! known-format scan of its latin1 text. `fixtures/ports/secret-cases.json` pins parity with TS.
//! JS regex features Rust's `regex` lacks (lookaround) are written as plain code.

use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::bundle::{paths, Bundle};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub path: String,
    /// `"<kind>: <snippet>"`, the TS finding's `kind` and `snippet`.
    pub hint: String,
}

/// A detector hit: (kind, snippet).
type Hit = (&'static str, String);

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("secret-scan regex"))
}

/// TS PREFIX_PATTERNS: known secret formats, matched anywhere. `(?-u:\b)` keeps JS's ASCII `\b`.
fn prefix_patterns() -> &'static [(&'static str, Regex)] {
    static PATTERNS: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        [
            ("anthropic", r"(?-u:\b)sk-ant-[A-Za-z0-9_-]{20,}"),
            (
                "openai",
                r"(?-u:\b)sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}",
            ),
            ("openai", r"(?-u:\b)sk-[A-Za-z0-9]{20,}(?-u:\b)"),
            ("github-pat", r"(?-u:\b)gh[posru]_[A-Za-z0-9]{30,}(?-u:\b)"),
            ("github-pat", r"(?-u:\b)github_pat_[A-Za-z0-9_]{22,}"),
            ("gitlab-pat", r"(?-u:\b)glpat-[A-Za-z0-9_-]{20,}"),
            ("google-api-key", r"(?-u:\b)AIza[0-9A-Za-z_-]{35}"),
            ("stripe", r"(?-u:\b)[rs]k_live_[A-Za-z0-9]{16,}"),
            ("slack", r"(?-u:\b)xox[baprs]-[A-Za-z0-9-]{10,}(?-u:\b)"),
            (
                "slack-webhook",
                r"hooks\.slack\.com/services/[A-Za-z0-9_/-]{20,}",
            ),
            (
                "discord-webhook",
                r"discord(?:app)?\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]{20,}",
            ),
            ("aws-access-key", r"(?-u:\b)AKIA[0-9A-Z]{16}(?-u:\b)"),
            (
                "private-key",
                r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z ]*-----",
            ),
            (
                "url-credentials",
                r"(?i)(?-u:\b)[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@$<{]+@",
            ),
        ]
        .into_iter()
        .map(|(kind, p)| (kind, Regex::new(p).expect("prefix regex")))
        .collect()
    })
}

/// TS PLACEHOLDER_RE: an allowed `${credentialRef:<slug-like name>}`.
fn placeholder_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(&RE, r"\$\{credentialRef:([A-Za-z0-9][A-Za-z0-9_.-]*)\}")
}

fn high_entropy_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(&RE, r"[A-Za-z0-9+/_=-]{32,}")
}

fn data_uri_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(&RE, r"(?i)data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/=]+")
}

fn integrity_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(&RE, r"(?i)(?-u:\b)sha(?:1|256|384|512)[-:][A-Za-z0-9+/=]+")
}

fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(&RE, r#"(?i)(?-u:\b)[a-z][a-z0-9+.-]*://[^\s"'<>()`]+"#)
}

/// TS ASSIGNMENT_RE: `name = value` / `"name": "value"` pairs.
fn assignment_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(
        &RE,
        r#"([A-Za-z_][A-Za-z0-9_.-]{0,63})["']?\s*[:=]\s*["']?((?:(?:Bearer|Basic|Token)\s+)?[A-Za-z0-9/+=_-]+)"#,
    )
}

fn secret_name_word_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    re(
        &RE,
        r"^(?:keys?|apikey|tokens?|secrets?|passwords?|passwd|pwd|pat|auth|authorization|credentials?)$",
    )
}

fn shannon_entropy(s: &str) -> f64 {
    let len = s.chars().count() as f64;
    if len == 0.0 {
        return 0.0;
    }
    let mut counts: HashMap<char, usize> = HashMap::new();
    for ch in s.chars() {
        *counts.entry(ch).or_insert(0) += 1;
    }
    counts.values().fold(0.0_f64, |bits, &c| {
        let p = c as f64 / len;
        bits - p * p.log2()
    })
}

/// TS `snippet`: truncate to "XXXXXX…XXXX" if longer than 12 chars.
fn make_snippet(m: &str) -> String {
    let chars: Vec<char> = m.chars().collect();
    if chars.len() <= 12 {
        m.to_string()
    } else {
        let start: String = chars[..6].iter().collect();
        let end: String = chars[chars.len() - 4..].iter().collect();
        format!("{start}\u{2026}{end}")
    }
}

/// TS `longestUnbrokenRun`: the longest segment between `/ _ + = . -` separators.
fn longest_unbroken_run(token: &str) -> &str {
    token
        .split(['/', '_', '+', '=', '.', '-'])
        .fold("", |longest, seg| {
            if seg.len() > longest.len() {
                seg
            } else {
                longest
            }
        })
}

/// TS `isSecretName`: `api key` anywhere, or any word (split on non-alphanumerics and at
/// lower→Upper camelCase boundaries) is a credential noun.
fn is_secret_name(name: &str) -> bool {
    static API_KEY: OnceLock<Regex> = OnceLock::new();
    if re(&API_KEY, r"(?i)api[_-]?key").is_match(name) {
        return true;
    }
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut prev: Option<char> = None;
    for c in name.chars() {
        if !c.is_ascii_alphanumeric() {
            words.push(std::mem::take(&mut current));
        } else {
            let boundary = c.is_ascii_uppercase()
                && prev.is_some_and(|p| p.is_ascii_lowercase() || p.is_ascii_digit());
            if boundary {
                words.push(std::mem::take(&mut current));
            }
            current.push(c);
        }
        prev = Some(c);
    }
    words.push(current);
    words
        .iter()
        .any(|w| secret_name_word_re().is_match(&w.to_lowercase()))
}

/// TS SECRET_SHAPED_VALUES: hex digests, UUIDs, and the AWS secret access key shape.
fn is_secret_shaped(value: &str) -> bool {
    static HEX: OnceLock<Regex> = OnceLock::new();
    static UUID: OnceLock<Regex> = OnceLock::new();
    if re(&HEX, r"(?i)^(?:[0-9a-f]{32}|[0-9a-f]{40}|[0-9a-f]{64})$").is_match(value)
        || re(
            &UUID,
            r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        )
        .is_match(value)
    {
        return true;
    }
    // ^(?=.*[0-9])(?=.*[a-z])(?=.*[A-Z])[A-Za-z0-9/+]{40}$
    value.chars().count() == 40
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '+')
        && value.chars().any(|c| c.is_ascii_digit())
        && value.chars().any(|c| c.is_ascii_lowercase())
        && value.chars().any(|c| c.is_ascii_uppercase())
}

/// TS `detectNamed`: a credential-shaped value under a secret-ish name.
fn detect_named(name: &str, value: &str) -> Option<Hit> {
    static SCHEME: OnceLock<Regex> = OnceLock::new();
    if !is_secret_name(name) {
        return None;
    }
    let trimmed = value.trim();
    let bare = re(&SCHEME, r"(?i)^(?:Bearer|Basic|Token)\s+").replace(trimmed, "");
    is_secret_shaped(&bare).then(|| ("named-secret", make_snippet(&bare)))
}

fn detect_known_format(text: &str) -> Option<Hit> {
    prefix_patterns()
        .iter()
        .find_map(|(kind, re)| re.find(text).map(|m| (*kind, make_snippet(m.as_str()))))
}

/// TS `urlSecretSurface`: keep only a URL's query/fragment (paths and hosts are public).
fn url_secret_surface(url: &str) -> String {
    match url.find(['?', '#']) {
        None => " ".to_string(),
        Some(cut) => format!(" {} ", url[cut + 1..].replace(['&', '#'], " ")),
    }
}

fn detect_high_entropy(text: &str) -> Option<Hit> {
    static PLAIN_WORD: OnceLock<Regex> = OnceLock::new();
    let surface = data_uri_re().replace_all(text, " ");
    let surface = integrity_re().replace_all(&surface, " ");
    let surface = url_re().replace_all(&surface, |c: &regex::Captures| url_secret_surface(&c[0]));
    for m in high_entropy_re().find_iter(&surface) {
        let token = m.as_str();
        let run = longest_unbroken_run(token);
        if run.len() < 20 {
            continue; // identifier / path, not a secret-like run
        }
        if re(&PLAIN_WORD, r"^(?:[a-z]+|[A-Z]+)$").is_match(run) {
            continue; // a plain word (e.g. an npm scope), not random
        }
        if shannon_entropy(token) >= 4.0 {
            return Some(("high-entropy", make_snippet(token)));
        }
    }
    None
}

/// TS `detectText`: known formats, then named assignments, then high entropy.
fn detect_text(text: &str) -> Option<Hit> {
    detect_known_format(text)
        .or_else(|| {
            assignment_re()
                .captures_iter(text)
                .find_map(|c| detect_named(&c[1], &c[2]))
        })
        .or_else(|| detect_high_entropy(text))
}

/// TS `detect`: placeholder names are scanned on their own, then the text without them.
fn detect(value: &str) -> Option<Hit> {
    placeholder_re()
        .captures_iter(value)
        .find_map(|c| detect_text(&c[1]))
        .or_else(|| detect_text(&placeholder_re().replace_all(value, "")))
}

/// Visit every object key and string value with its field path (array items add an index).
fn walk_json(
    node: &Value,
    field_path: &mut Vec<String>,
    on_string: &mut dyn FnMut(&str, &[String]),
) {
    match node {
        Value::String(s) => on_string(s, field_path),
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                field_path.push(i.to_string());
                walk_json(item, field_path, on_string);
                field_path.pop();
            }
        }
        Value::Object(map) => {
            for (k, v) in map {
                field_path.push(k.clone());
                field_path.push("<key>".into());
                on_string(k, field_path);
                field_path.pop();
                walk_json(v, field_path, on_string);
                field_path.pop();
            }
        }
        _ => {}
    }
}

/// JSON fields that legitimately hold public key material / signatures, per bundle file.
fn is_allowlisted_field(path: &str, field: &str) -> bool {
    match path {
        p if p == paths::SIGNATURE => matches!(field, "publicKey" | "signature" | "digest"),
        p if p == paths::MANIFEST => field == "author.pubkey",
        _ => false,
    }
}

fn scan_json(path: &str, json: &Value, record: &mut dyn FnMut(Option<Hit>)) {
    walk_json(json, &mut Vec::new(), &mut |value, field_path| {
        if is_allowlisted_field(path, &field_path.join(".")) {
            return;
        }
        record(detect(value));
        if let Some(name) = field_path.last() {
            if name != "<key>" {
                record(detect_named(name, value));
            }
        }
    });
}

/// TS `decodeText`: UTF-8 without NULs (a leading BOM dropped, as TextDecoder does); else None.
fn decode_text(bytes: &[u8]) -> Option<&str> {
    if bytes.contains(&0) {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    Some(text.strip_prefix('\u{feff}').unwrap_or(text))
}

/// Port of TS `isLikelySecretValue`: known format, named credential or high entropy.
pub fn is_likely_secret_value(value: &str) -> bool {
    detect(value).is_some()
}

/// Port of TS `scanForSecrets(bundle)`: one finding per detector hit, in bundle order.
pub fn scan_for_secrets(bundle: &Bundle) -> Vec<Finding> {
    let mut findings = Vec::new();
    for (path, bytes) in bundle.entries() {
        let mut record = |hit: Option<Hit>| {
            if let Some((kind, snippet)) = hit {
                findings.push(Finding {
                    path: path.clone(),
                    hint: format!("{kind}: {snippet}"),
                });
            }
        };
        let Some(text) = decode_text(bytes) else {
            // Binary asset: entropy is meaningless, but known formats can't hide in it.
            let latin1: String = bytes.iter().map(|&b| char::from(b)).collect();
            record(detect_known_format(&latin1));
            continue;
        };
        if path.ends_with(".json") || path.ends_with(".jsonl") {
            let lines: Vec<&str> = if path.ends_with(".jsonl") {
                text.split('\n').collect()
            } else {
                vec![text]
            };
            for line in lines {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<Value>(trimmed) {
                    Ok(json) => scan_json(path, &json, &mut record),
                    Err(_) => record(detect(trimmed)), // malformed JSON: text scan
                }
            }
        } else {
            record(detect(text));
        }
    }
    findings
}

/// Format findings into the canonical error string:
/// `secret scan failed: <path>: <kind>: <snippet>[; …]`.
pub fn format_scan_error(findings: &[Finding]) -> String {
    let parts: Vec<String> = findings
        .iter()
        .map(|f| format!("{}: {}", f.path, f.hint))
        .collect();
    format!("secret scan failed: {}", parts.join("; "))
}
