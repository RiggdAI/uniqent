use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::{json, Value};

// ─── Secret detection helpers ─────────────────────────────────────────────────

fn secret_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(KEY|TOKEN|SECRET|PASSWORD|PASS|PAT|AUTH|APIKEY|ACCESS|CREDENTIAL)")
            .unwrap()
    })
}

fn is_secret_name(name: &str) -> bool {
    secret_name_re().is_match(name)
}

fn placeholder_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\$\{credentialRef:[^}]+\}").unwrap())
}

fn openai_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"sk-[A-Za-z0-9]{20,}").unwrap())
}

fn github_pat_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"gh[posru]_[A-Za-z0-9]{30,}").unwrap())
}

fn slack_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"xox[baprs]-[A-Za-z0-9\-]{10,}").unwrap())
}

fn aws_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"AKIA[0-9A-Z]{16}").unwrap())
}

fn privkey_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----").unwrap())
}

fn high_entropy_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"[A-Za-z0-9+/_=\-]{32,}").unwrap())
}

fn longest_unbroken_run(token: &str) -> usize {
    token
        .split(['/', '_', '+', '=', '.', '-'])
        .map(|s| s.len())
        .max()
        .unwrap_or(0)
}

fn shannon_entropy(s: &str) -> f64 {
    let len = s.len() as f64;
    if len == 0.0 {
        return 0.0;
    }
    let mut counts: HashMap<char, usize> = HashMap::new();
    for ch in s.chars() {
        *counts.entry(ch).or_insert(0) += 1;
    }
    counts.values().fold(0.0f64, |acc, &c| {
        let p = c as f64 / len;
        acc - p * p.log2()
    })
}

fn is_likely_secret_value(value: &str) -> bool {
    // Strip credentialRef placeholders
    let cleaned = placeholder_re().replace_all(value, "").to_string();

    // Known-prefix patterns
    if openai_re().is_match(&cleaned)
        || github_pat_re().is_match(&cleaned)
        || slack_re().is_match(&cleaned)
        || aws_re().is_match(&cleaned)
        || privkey_re().is_match(&cleaned)
    {
        return true;
    }

    // High-entropy check
    for m in high_entropy_re().find_iter(&cleaned) {
        let token = m.as_str();
        if longest_unbroken_run(token) >= 20 && shannon_entropy(token) >= 4.0 {
            return true;
        }
    }

    false
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
    // id: string, min 1
    let id = server["id"].as_str().filter(|s| !s.is_empty()).ok_or("id required")?;

    // transport: enum
    let transport = server["transport"].as_str().ok_or("transport required")?;
    match transport {
        "stdio" | "sse" | "streamable-http" => {}
        _ => return Err(format!("invalid transport: {transport}")),
    }

    // HTTP transports require url
    if (transport == "sse" || transport == "streamable-http") && server["url"].as_str().is_none() {
        return Err(format!("transport \"{transport}\" requires a url"));
    }

    // stdio requires command
    if transport == "stdio" && server["command"].as_str().is_none() {
        return Err("transport \"stdio\" requires a command".to_string());
    }

    // auth.type=header requires headerName
    if server["auth"]["type"].as_str() == Some("header")
        && server["auth"]["headerName"].as_str().is_none()
    {
        return Err("auth type \"header\" requires headerName".to_string());
    }

    let _ = id;
    Ok(server.clone())
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
    let has_url = raw["url"].as_str().is_some();
    let has_command = raw["command"].as_str().is_some();
    let is_remote = has_url && !has_command;

    if is_remote {
        let url = raw["url"].as_str().unwrap();

        let transport = if sse_url_re().is_match(url) || raw["transport"].as_str() == Some("sse") {
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
        let args: Vec<Value> = raw["args"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a.as_str().map(|s| json!(s)))
                    .collect()
            })
            .unwrap_or_default();

        let mut env = serde_json::Map::new();
        if let Some(env_obj) = raw["env"].as_object() {
            for (k, v) in env_obj {
                if let Some(vs) = v.as_str() {
                    if is_secret_name(k) || is_likely_secret_value(vs) {
                        let r = format!("{id}_{}", ref_suffix(k));
                        env.insert(k.clone(), json!(format!("${{credentialRef:{r}}}")));
                        creds.push(cred_for(&r, k, id));
                    } else {
                        env.insert(k.clone(), json!(vs));
                    }
                }
            }
        }

        let command = raw["command"].as_str().unwrap_or("npx");

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
        if let Ok(validated) = validate_mcp_server(&attempt) {
            out["servers"].as_array_mut().unwrap().push(validated);
            return out;
        }
        // Falls through on validation failure
    }

    // mcpServers object
    if let Some(mcp_servers) = input["mcpServers"].as_object() {
        // Clone to avoid borrow issues
        let entries: Vec<(String, Value)> = mcp_servers
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (name, raw) in entries {
            let id = slugify_id(&name);
            let raw_obj = if raw.is_null() { json!({}) } else { raw };
            map_one(&id, &raw_obj, &mut out);
        }
        return out;
    }

    // servers array
    if let Some(servers) = input["servers"].as_array() {
        let servers: Vec<Value> = servers.to_vec();
        for raw in servers {
            let id = raw["id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(slugify_id)
                .unwrap_or_else(|| "mcp-server".to_string());
            map_one(&id, &raw, &mut out);
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
        assert!(!is_secret_name("LANG"));
    }

    #[test]
    fn is_likely_secret_value_openai_prefix() {
        assert!(is_likely_secret_value("sk-abcdefghijklmnopqrstuvwxyz0123"));
        assert!(!is_likely_secret_value("short"));
        assert!(!is_likely_secret_value("en"));
    }
}
