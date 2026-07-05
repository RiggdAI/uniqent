//! Port of packages/core/src/secret-scan.ts
//!
//! Faithfully reproduces every rule from the TS scanner:
//! - PREFIX_PATTERNS: openai, github-pat, slack, aws-access-key, private-key
//! - HIGH_ENTROPY_TOKEN detection with Shannon-entropy >= 4.0 and longest unbroken run >= 20
//! - PLACEHOLDER_RE: strips ${credentialRef:...} before scanning
//! - BINARY_EXT: skips png/jpg/gif/webp/avif/ico/bmp/svg paths
//! - ALLOWLISTED_KEYS: "pubkey" and "publicKey" JSON keys skip value scanning
//! - Skips signature.json
//! - JSON / JSONL files: walks JSON AST; malformed falls back to raw text scan
//! - Other files: scanned as raw text

use regex::Regex;
use std::sync::OnceLock;

use super::bundle::{paths, Bundle};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub path: String,
    pub hint: String,
}

// ---------------------------------------------------------------------------
// Compiled patterns (lazy-initialized once)
// ---------------------------------------------------------------------------

struct PrefixPattern {
    kind: &'static str,
    re: Regex,
}

fn prefix_patterns() -> &'static [PrefixPattern] {
    static PATTERNS: OnceLock<Vec<PrefixPattern>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            // TS: /\bsk-[A-Za-z0-9]{20,}\b/
            PrefixPattern {
                kind: "openai",
                re: Regex::new(r"\bsk-[A-Za-z0-9]{20,}\b").unwrap(),
            },
            // TS: /\bgh[posru]_[A-Za-z0-9]{30,}\b/
            PrefixPattern {
                kind: "github-pat",
                re: Regex::new(r"\bgh[posru]_[A-Za-z0-9]{30,}\b").unwrap(),
            },
            // TS: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/
            PrefixPattern {
                kind: "slack",
                re: Regex::new(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b").unwrap(),
            },
            // TS: /\bAKIA[0-9A-Z]{16}\b/
            PrefixPattern {
                kind: "aws-access-key",
                re: Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(),
            },
            // TS: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/
            PrefixPattern {
                kind: "private-key",
                re: Regex::new(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----").unwrap(),
            },
        ]
    })
}

/// TS: /\$\{credentialRef:[^}]+\}/g  — strip before scanning
fn placeholder_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\$\{credentialRef:[^}]+\}").unwrap())
}

/// TS: /[A-Za-z0-9+/_=-]{32,}/g
fn high_entropy_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[A-Za-z0-9+/_=\-]{32,}").unwrap())
}

/// TS: /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/i
fn binary_ext_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$").unwrap())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Matches TS `ALLOWLISTED_KEYS = new Set(['pubkey', 'publicKey'])`.
fn is_allowlisted_key(key: &str) -> bool {
    key == "pubkey" || key == "publicKey"
}

/// Shannon entropy of a UTF-8 string — matches TS `shannonEntropy`.
fn shannon_entropy(s: &str) -> f64 {
    let chars: Vec<char> = s.chars().collect();
    let len = chars.len() as f64;
    if len == 0.0 {
        return 0.0;
    }
    let mut counts = std::collections::HashMap::<char, usize>::new();
    for ch in &chars {
        *counts.entry(*ch).or_insert(0) += 1;
    }
    counts.values().fold(0.0_f64, |bits, &c| {
        let p = c as f64 / len;
        bits - p * p.log2()
    })
}

/// TS `longestUnbrokenRun`: split on `[/_+=.-]`, return max segment length.
fn longest_unbroken_run(token: &str) -> usize {
    token
        .split(['/', '_', '+', '=', '.', '-'])
        .map(|s| s.len())
        .max()
        .unwrap_or(0)
}

/// TS `snippet`: truncate to "XXXXXX…XXXX" if > 12 chars.
fn make_snippet(m: &str) -> String {
    if m.len() <= 12 {
        m.to_string()
    } else {
        let start: String = m.chars().take(6).collect();
        let end: String = m
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{start}\u{2026}{end}")
    }
}

/// TS `detect(value)`: check prefix patterns then high-entropy.
/// Returns `Some((kind, snippet))` on a hit.
fn detect(value: &str) -> Option<(String, String)> {
    let cleaned = placeholder_re().replace_all(value, "");
    let cleaned = cleaned.as_ref();

    // 1. PREFIX_PATTERNS (in order)
    for pat in prefix_patterns() {
        if let Some(m) = pat.re.find(cleaned) {
            return Some((pat.kind.to_string(), make_snippet(m.as_str())));
        }
    }

    // 2. HIGH_ENTROPY_TOKEN: /[A-Za-z0-9+/_=-]{32,}/g
    for m in high_entropy_re().find_iter(cleaned) {
        let token = m.as_str();
        // TS: if longestUnbrokenRun < 20 → skip (natural identifier / path)
        if longest_unbroken_run(token) < 20 {
            continue;
        }
        // TS: shannonEntropy >= 4.0
        if shannon_entropy(token) >= 4.0 {
            return Some(("high-entropy".to_string(), make_snippet(token)));
        }
    }

    None
}

// ---------------------------------------------------------------------------
// JSON walker — mirrors TS `walkJson`
// ---------------------------------------------------------------------------

fn walk_json(node: &serde_json::Value, key: Option<&str>, on_string: &mut dyn FnMut(&str)) {
    match node {
        serde_json::Value::String(s) => {
            // Skip allowlisted keys (TS: if key in ALLOWLISTED_KEYS → return)
            if key.is_some_and(is_allowlisted_key) {
                return;
            }
            on_string(s);
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                walk_json(item, None, on_string);
            }
        }
        serde_json::Value::Object(map) => {
            for (k, v) in map {
                walk_json(v, Some(k.as_str()), on_string);
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Port of TS `isLikelySecretValue(value: string): boolean`.
pub fn is_likely_secret_value(value: &str) -> bool {
    detect(value).is_some()
}

/// Port of TS `scanForSecrets(bundle: Bundle): SecretFinding[]`.
///
/// Returns a `Finding` per suspicious path. The `hint` field combines the TS
/// `kind` and `snippet` fields into `"<kind>: <snippet>"`.
pub fn scan_for_secrets(bundle: &Bundle) -> Vec<Finding> {
    let mut findings = Vec::new();

    for (path, bytes) in bundle.entries() {
        // TS: if path === PATHS.signature → continue
        if path == paths::SIGNATURE {
            continue;
        }
        // TS: if BINARY_EXT.test(path) → continue (binary asset — not a text surface)
        if binary_ext_re().is_match(path) {
            continue;
        }

        // TS: const text = dec.decode(bytes)
        // Non-UTF-8 bytes are replaced (same as JS TextDecoder default); no panic.
        let text = String::from_utf8_lossy(bytes);

        let mut record = |hit: Option<(String, String)>| {
            if let Some((kind, snip)) = hit {
                findings.push(Finding {
                    path: path.clone(),
                    hint: format!("{kind}: {snip}"),
                });
            }
        };

        if path.ends_with(".json") || path.ends_with(".jsonl") {
            let lines: Vec<&str> = if path.ends_with(".jsonl") {
                text.split('\n').collect()
            } else {
                vec![text.as_ref()]
            };
            for line in lines {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(node) => {
                        // TS: walkJson(JSON.parse(trimmed), undefined, s => record(detect(s)))
                        // Record EVERY hit — a JSON file with two secrets yields two findings.
                        let mut hits: Vec<(String, String)> = Vec::new();
                        walk_json(&node, None, &mut |s| {
                            if let Some(hit) = detect(s) {
                                hits.push(hit);
                            }
                        });
                        for hit in hits {
                            record(Some(hit));
                        }
                    }
                    Err(_) => {
                        // TS: malformed JSON — fall back to raw text scan
                        record(detect(trimmed));
                    }
                }
            }
        } else {
            record(detect(text.as_ref()));
        }
    }

    findings
}

/// Format a Vec<Finding> into the canonical error string.
/// Format: `secret scan failed: <path>: <hint>[; …]`
pub fn format_scan_error(findings: &[Finding]) -> String {
    let parts: Vec<String> = findings
        .iter()
        .map(|f| format!("{}: {}", f.path, f.hint))
        .collect();
    format!("secret scan failed: {}", parts.join("; "))
}
