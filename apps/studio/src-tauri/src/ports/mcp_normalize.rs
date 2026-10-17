use std::collections::HashSet;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

// ─── Secret detection helpers ─────────────────────────────────────────────────

use crate::core::secret_scan::is_likely_secret_value;
use crate::session::mcp_server_problem;

/// Final name words that mark a credential (TS SECRET_NAME_WORDS). Env/header names put the noun
/// last (GITHUB_TOKEN, X-API-Key, DB_PASSWORD), so PATH, AUTHOR_NAME or TOKEN_URL are not secrets.
const SECRET_NAME_WORDS: [&str; 14] = [
    "key",
    "apikey",
    "token",
    "secret",
    "password",
    "passwd",
    "pwd",
    "pass",
    "pat",
    "auth",
    "authorization",
    "authentication",
    "credential",
    "credentials",
];

/// Whether an env var / header name denotes a credential, judged by its last word
/// (camelCase is split first). Mirrors TS `isSecretName` in builder/src/mcp/normalize.ts.
fn is_secret_name(name: &str) -> bool {
    static CAMEL: OnceLock<Regex> = OnceLock::new();
    let split = CAMEL
        .get_or_init(|| Regex::new(r"([a-z0-9])([A-Z])").unwrap())
        .replace_all(name, "${1}_${2}")
        .to_lowercase();
    split
        .split(|c: char| !c.is_ascii_lowercase() && !c.is_ascii_digit())
        .rfind(|w| !w.is_empty())
        .is_some_and(|last| SECRET_NAME_WORDS.contains(&last))
}

/// An env value that already is a `${credentialRef:…}` placeholder (kept as-is).
fn is_credential_ref(value: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^\$\{credentialRef:[^}]+\}$").unwrap())
        .is_match(value)
}

// ─── ID / ref helpers ─────────────────────────────────────────────────────────

/// Mirror TS slugifyId: lowercase, runs of non-alnum→'-', trim/collapse dashes.
fn slugify_id(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut out = String::new();
    let mut in_sep = true; // start true so leading separators are skipped
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            in_sep = false;
        } else if !in_sep {
            out.push('-');
            in_sep = true;
        }
    }
    // trim trailing dash
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "mcp-server".to_string()
    } else {
        out
    }
}

/// Mirror TS refSuffix: lowercase, runs of non-alnum→'_', trim underscores.
fn ref_suffix(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut out = String::new();
    let mut in_sep = true; // start true to skip leading underscores
    for c in lower.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            in_sep = false;
        } else if !in_sep {
            out.push('_');
            in_sep = true;
        }
    }
    out.trim_end_matches('_').to_string()
}

fn cred_for(r: &str, label: &str, id: &str) -> Value {
    json!({
        "ref": r,
        "label": label,
        "type": "apiKey",
        "consumedBy": [format!("mcp:{id}")],
        "required": true
    })
}

// ─── McpServer validation (mirrors Zod McpServerSchema) ──────────────────────

fn validate_mcp_server(server: &Value) -> Result<Value, String> {
    if let Some(problem) = mcp_server_problem(server) {
        return Err(problem);
    }
    // Like zod, keep only the schema's keys.
    let mut out = serde_json::Map::new();
    for key in [
        "id",
        "transport",
        "url",
        "command",
        "args",
        "env",
        "auth",
        "tools",
        "description",
    ] {
        if let Some(v) = server.get(key) {
            out.insert(key.to_string(), v.clone());
        }
    }
    Ok(Value::Object(out))
}

/// Replace every secret env value (by name or by value) with a `${credentialRef:…}` placeholder
/// and record its requirement; existing placeholders are kept. Mirrors TS `liftEnv`.
fn lift_env(
    id: &str,
    raw_env: &serde_json::Map<String, Value>,
    creds: &mut Vec<Value>,
) -> serde_json::Map<String, Value> {
    let mut env = serde_json::Map::new();
    for (k, v) in raw_env {
        let Some(vs) = v.as_str() else { continue };
        if is_credential_ref(vs) {
            env.insert(k.clone(), json!(vs));
        } else if is_secret_name(k) || is_likely_secret_value(vs) {
            let r = format!("{id}_{}", ref_suffix(k));
            env.insert(k.clone(), json!(format!("${{credentialRef:{r}}}")));
            creds.push(cred_for(&r, k, id));
        } else {
            env.insert(k.clone(), json!(vs));
        }
    }
    env
}

/// `base`, or `base-2`, `base-3`, … — the first id not yet taken (then marks it taken).
fn unique_id(base: &str, taken: &mut HashSet<String>) -> String {
    let mut id = base.to_string();
    let mut n = 2;
    while taken.contains(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    taken.insert(id.clone());
    id
}

fn push_validated(server: Value, creds: Vec<Value>, out: &mut Value) {
    match validate_mcp_server(&server) {
        Ok(s) => {
            out["servers"].as_array_mut().unwrap().push(s);
            let credentials = out["credentials"].as_array_mut().unwrap();
            for c in creds {
                credentials.push(c);
            }
        }
        Err(msg) => {
            out["lossiness"]
                .as_array_mut()
                .unwrap()
                .push(json!(format!("skipped a server: {msg}")));
        }
    }
}

// ─── SSE URL detection ────────────────────────────────────────────────────────

fn sse_url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    // Mirror JS: /sse(\b|$|\/)/.test(url)  — \b works in Rust regex
    RE.get_or_init(|| Regex::new(r"sse(\b|$|/)").unwrap())
}

fn auth_header_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?i)^authorization$").unwrap())
}

// ─── mapOne ───────────────────────────────────────────────────────────────────

fn map_one(id: &str, raw: &Value, out: &mut Value) {
    let mut creds: Vec<Value> = Vec::new();
    let description = raw["description"].as_str().map(|s| s.to_string());
    let has_url = raw["url"].as_str().is_some_and(|u| !u.is_empty());
    let has_command = raw["command"].as_str().is_some_and(|c| !c.is_empty());
    let is_remote = has_url && !has_command;

    if is_remote {
        let url = raw["url"].as_str().unwrap();

        // `transport` is ours/Claude's; VS Code's mcp.json names it `type` ("http" | "sse").
        let transport = if sse_url_re().is_match(url)
            || raw["transport"].as_str() == Some("sse")
            || raw["type"].as_str() == Some("sse")
        {
            "sse"
        } else {
            "streamable-http"
        };

        let mut auth = json!({"type": "none"});

        // Collect secret headers — preserve insertion order from the JSON object
        let empty_map = serde_json::Map::new();
        let headers = raw["headers"].as_object().unwrap_or(&empty_map);
        let secret_headers: Vec<(&str, &str)> = headers
            .iter()
            .filter_map(|(k, v)| {
                let vs = v.as_str()?;
                if is_secret_name(k) || is_likely_secret_value(vs) {
                    Some((k.as_str(), vs))
                } else {
                    None
                }
            })
            .collect();

        if !secret_headers.is_empty() {
            let (h_name, _) = secret_headers[0];
            if auth_header_re().is_match(h_name) {
                let r = format!("{id}_token");
                auth = json!({"type": "bearer", "credentialRef": r});
                creds.push(cred_for(&r, h_name, id));
            } else {
                let r = format!("{id}_{}", ref_suffix(h_name));
                auth = json!({"type": "header", "headerName": h_name, "credentialRef": r});
                creds.push(cred_for(&r, h_name, id));
            }
            if secret_headers.len() > 1 {
                let dropped: Vec<&str> = secret_headers[1..].iter().map(|(k, _)| *k).collect();
                out["lossiness"].as_array_mut().unwrap().push(json!(format!(
                    "{id}: only the first auth header is kept; dropped {}",
                    dropped.join(", ")
                )));
            }
        }

        let mut server = json!({
            "id": id,
            "transport": transport,
            "url": url,
            "auth": auth,
            "tools": {"include": "all"}
        });
        if let Some(desc) = description {
            server["description"] = json!(desc);
        }
        push_validated(server, creds, out);
    } else {
        // stdio path
        let Some(command) = raw["command"].as_str().filter(|c| !c.is_empty()) else {
            out["lossiness"].as_array_mut().unwrap().push(json!(format!(
                "skipped server \"{id}\": it has neither a command nor a url"
            )));
            return;
        };
        let args: Vec<Value> = raw["args"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a.as_str().map(|s| json!(s)))
                    .collect()
            })
            .unwrap_or_default();

        let empty_env = serde_json::Map::new();
        let env = lift_env(id, raw["env"].as_object().unwrap_or(&empty_env), &mut creds);

        let mut server = json!({
            "id": id,
            "transport": "stdio",
            "command": command,
            "auth": {"type": "none"},
            "tools": {"include": "all"}
        });
        if !args.is_empty() {
            server["args"] = Value::Array(args);
        }
        if !env.is_empty() {
            server["env"] = Value::Object(env);
        }
        if let Some(desc) = description {
            server["description"] = json!(desc);
        }
        push_validated(server, creds, out);
    }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/// Normalize any common MCP config shape to canonical servers + lifted credentials.
/// Mirrors TS normalizeMcpConfig exactly, operating on a parsed JSON Value.
///
/// Never panics — unknown shapes return a lossiness note.
pub fn normalize_mcp_config(input: &Value) -> Value {
    let mut out = json!({
        "servers": [],
        "credentials": [],
        "lossiness": []
    });

    // Non-object input (null, array, string, number, bool)
    if !input.is_object() {
        out["lossiness"]
            .as_array_mut()
            .unwrap()
            .push(json!("unrecognized MCP config format"));
        return out;
    }

    let obj = input.as_object().unwrap();

    // Already-canonical: has id (string) + transport (string)
    if let (Some(id), Some(_transport)) = (
        obj.get("id").and_then(|v| v.as_str()),
        obj.get("transport").and_then(|v| v.as_str()),
    ) {
        let _ = id;
        // Build attempt: defaults first, then overlay input fields
        let mut attempt = json!({"tools": {"include": "all"}});
        for (k, v) in obj {
            attempt[k] = v.clone();
        }
        if let Ok(mut validated) = validate_mcp_server(&attempt) {
            // Secrets are still lifted from canonical-shaped input.
            let mut creds: Vec<Value> = Vec::new();
            if let Some(raw_env) = validated.get("env").and_then(Value::as_object).cloned() {
                let sid = validated["id"].as_str().unwrap_or("").to_string();
                validated["env"] = Value::Object(lift_env(&sid, &raw_env, &mut creds));
            }
            push_validated(validated, creds, &mut out);
            return out;
        }
        // Falls through on validation failure
    }

    let mut taken: HashSet<String> = HashSet::new();
    // Claude/Cursor `mcpServers` map, or VS Code's `servers` map (same per-server shape).
    // Mirrors TS `obj.mcpServers ?? (Array.isArray(obj.servers) ? undefined : obj.servers)`.
    let server_map = match obj.get("mcpServers").filter(|v| !v.is_null()) {
        Some(v) => Some(v),
        None => obj.get("servers").filter(|v| !v.is_null() && !v.is_array()),
    };
    // JS `Object.entries` on an object (or an array, keyed by index).
    let entries: Option<Vec<(String, Value)>> = match server_map {
        Some(Value::Object(m)) => Some(m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
        Some(Value::Array(a)) => Some(
            a.iter()
                .enumerate()
                .map(|(i, v)| (i.to_string(), v.clone()))
                .collect(),
        ),
        _ => None,
    };
    if let Some(entries) = entries {
        for (name, raw) in entries {
            let id = unique_id(&slugify_id(&name), &mut taken);
            let raw_obj = if raw.is_null() { json!({}) } else { raw };
            map_one(&id, &raw_obj, &mut out);
        }
        return out;
    }

    // servers array
    if let Some(servers) = input["servers"].as_array() {
        let servers: Vec<Value> = servers.to_vec();
        for raw in servers {
            let base = raw["id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(slugify_id)
                .unwrap_or_else(|| "mcp-server".to_string());
            let id = unique_id(&base, &mut taken);
            let raw_obj = if raw.is_null() { json!({}) } else { raw };
            map_one(&id, &raw_obj, &mut out);
        }
        return out;
    }

    // Bare single server (command or url present)
    if input["command"].is_string() || input["url"].is_string() {
        let id = input["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(slugify_id)
            .unwrap_or_else(|| "mcp-server".to_string());
        map_one(&id, input, &mut out);
        return out;
    }

    out["lossiness"]
        .as_array_mut()
        .unwrap()
        .push(json!("unrecognized MCP config format"));
    out
}

// ─── Unit tests ───────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_id_basic() {
        assert_eq!(slugify_id("brave-search"), "brave-search");
        assert_eq!(slugify_id("My Server!"), "my-server");
        assert_eq!(slugify_id("X_API_KEY"), "x-api-key");
        assert_eq!(slugify_id(""), "mcp-server");
        assert_eq!(slugify_id("---"), "mcp-server");
    }

    #[test]
    fn ref_suffix_basic() {
        assert_eq!(ref_suffix("BRAVE_API_KEY"), "brave_api_key");
        assert_eq!(ref_suffix("X-API-Key"), "x_api_key");
        assert_eq!(ref_suffix("Authorization"), "authorization");
    }

    #[test]
    fn is_secret_name_matches() {
        assert!(is_secret_name("BRAVE_API_KEY"));
        assert!(is_secret_name("API_TOKEN"));
        assert!(is_secret_name("OPENAI_API_KEY"));
        assert!(is_secret_name("xApiKey"));
        assert!(!is_secret_name("LANG"));
        assert!(!is_secret_name("PATH"));
        assert!(!is_secret_name("AUTHOR_NAME"));
        assert!(!is_secret_name("MEMORY_FILE_PATH"));
        assert!(!is_secret_name("TOKEN_URL"));
    }

    #[test]
    fn is_likely_secret_value_openai_prefix() {
        assert!(is_likely_secret_value("sk-abcdefghijklmnopqrstuvwxyz0123"));
        assert!(!is_likely_secret_value("short"));
        assert!(!is_likely_secret_value("en"));
    }
}
