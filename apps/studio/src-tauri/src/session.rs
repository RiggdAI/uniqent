use base64::Engine;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

use crate::core::archive::{pack_checked, unpack};
use crate::core::bundle::Bundle;
use crate::core::secret_scan::is_likely_secret_value;
use crate::core::signing::{generate_keypair, sign, verify, Keypair};

mod load;
pub(crate) use load::mcp_server_problem;

/// Validate `name` against the Slug pattern: `^[a-z0-9][a-z0-9-]*$`
fn is_valid_slug(s: &str) -> bool {
    let re = Regex::new(r"^[a-z0-9][a-z0-9-]*$").expect("slug regex");
    re.is_match(s)
}

/// Validate `version` against the semver 2.0.0 pattern.
fn is_valid_semver(s: &str) -> bool {
    let re = Regex::new(
        r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$",
    )
    .expect("semver regex");
    re.is_match(s)
}

/// Build the validation object from the current name and version.
pub fn validate_manifest(name: &str, version: &str) -> Value {
    let mut errors: Vec<Value> = Vec::new();

    if !is_valid_slug(name) {
        errors.push(json!({
            "path": "uniqent.json",
            "code": "manifest",
            "message": "name must be a lowercase slug (a-z, 0-9, hyphens)"
        }));
    }

    if !is_valid_semver(version) {
        errors.push(json!({
            "path": "uniqent.json",
            "code": "manifest",
            "message": "version must be a valid semver (e.g. 1.2.3)"
        }));
    }

    json!({
        "ok": errors.is_empty(),
        "errors": errors,
        "warnings": []
    })
}

/// The current UTC time as an ISO-8601 timestamp with millisecond precision, the same shape as
/// JS `new Date().toISOString()` (e.g. `2026-09-27T12:00:00.000Z`).
fn now_iso() -> String {
    let t = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second(),
        t.millisecond()
    )
}

/// The five standard cron fields, in order, with their inclusive numeric bounds.
const CRON_FIELDS: [(&str, u32, u32); 5] = [
    ("minute", 0, 59),
    ("hour", 0, 23),
    ("day-of-month", 1, 31),
    ("month", 1, 12),
    ("day-of-week", 0, 7),
];

/// Whether a profile field survives `set_profile`: its trimmed name and trimmed value are non-empty.
fn profile_field_kept(name: &str, value: &str) -> bool {
    !name.trim().is_empty() && !value.trim().is_empty()
}

/// Explain why `expr` is not a standard 5-field cron expression (numbers, ranges, lists, steps,
/// `*`), each value within its field's range in `CRON_FIELDS`, or `None` when it is valid.
pub fn cron_problem(expr: &str) -> Option<String> {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != CRON_FIELDS.len() {
        return Some(format!(
            "expected 5 space-separated fields (minute hour day-of-month month day-of-week), got {}",
            parts.len()
        ));
    }
    let item_re = Regex::new(r"^(?:\*|(\d+)(?:-(\d+))?)(?:/(\d+))?$").expect("cron regex");
    for (value, (name, min, max)) in parts.iter().zip(CRON_FIELDS) {
        for item in value.split(',') {
            let Some(caps) = item_re.captures(item) else {
                return Some(format!(
                    "{name} field \"{value}\" must be *, a number, a range, a list or a step"
                ));
            };
            let num = |i: usize| {
                caps.get(i)
                    .map(|m| m.as_str().parse::<u64>().unwrap_or(u64::MAX))
            };
            let (lo, hi, step) = (num(1), num(2), num(3));
            for n in [lo, hi].into_iter().flatten() {
                if n < u64::from(min) || n > u64::from(max) {
                    let shown = if n == u64::MAX {
                        "(too large)".to_string()
                    } else {
                        n.to_string()
                    };
                    return Some(format!("{name} value {shown} is out of range {min}-{max}"));
                }
            }
            if let (Some(lo), Some(hi)) = (lo, hi) {
                if lo > hi {
                    return Some(format!("{name} range \"{item}\" runs backwards"));
                }
            }
            if step == Some(0) {
                return Some(format!("{name} step must be at least 1"));
            }
        }
    }
    None
}

/// A value's JSON type, for errors about fields that may hold secrets (never the value itself).
fn json_type(v: &Value) -> &'static str {
    match v {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "an array",
        Value::Object(_) => "an object",
    }
}

/// Validate an optional memory importance (a number in 0..=1); `field` names it in errors.
fn validate_importance(value: Option<&Value>, field: &str) -> Result<Option<Value>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64() {
            Some(n) if (0.0..=1.0).contains(&n) => Ok(Some(v.clone())),
            _ => Err(format!(
                "{field} must be a number between 0 and 1, got {}",
                json_type(v)
            )),
        },
    }
}

/// Validate an optional memory visibility ("shareable" | "personal"); `field` names it in errors.
fn validate_visibility(value: Option<&Value>, field: &str) -> Result<Option<&'static str>, String> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_str() {
            Some("shareable") => Ok(Some("shareable")),
            Some("personal") => Ok(Some("personal")),
            _ => Err(format!(
                "{field} must be \"shareable\" or \"personal\", got {}",
                json_type(v)
            )),
        },
    }
}

/// A credential requirement in the spec's shape (never a value). Mirrors CredentialRequirement.
fn validate_credential(c: &Value) -> Result<(), String> {
    const TYPES: [&str; 5] = ["apiKey", "bearer", "header", "oauth2", "envVar"];
    let non_empty = |k: &str| c[k].as_str().is_some_and(|v| !v.is_empty());
    if !c.is_object() {
        return Err(format!("must be an object, got {}", json_type(c)));
    }
    if !non_empty("ref") {
        return Err("ref must be a non-empty string".into());
    }
    if !non_empty("label") {
        return Err("label must be a non-empty string".into());
    }
    let ty = c["type"].as_str().unwrap_or("");
    if !TYPES.contains(&ty) {
        return Err(format!(
            "type must be one of {}, got {}",
            TYPES.join("|"),
            json_type(&c["type"])
        ));
    }
    let consumers_ok = c["consumedBy"]
        .as_array()
        .is_some_and(|a| a.iter().all(Value::is_string));
    if !consumers_ok {
        return Err("consumedBy must be an array of strings".into());
    }
    if !c["required"].is_boolean() {
        return Err("required must be a boolean".into());
    }
    // Optional fields must be absent or well-typed: an explicit null fails zod, so reject it here.
    if c.get("help").is_some_and(|h| !h.is_string()) {
        return Err(format!(
            "help must be a string when present, got {}",
            json_type(&c["help"])
        ));
    }
    if c.get("oauth").is_some_and(|o| !o.is_object()) {
        return Err(format!(
            "oauth must be an object when present, got {}",
            json_type(&c["oauth"])
        ));
    }
    if c.get("oauth").is_some() && ty != "oauth2" {
        return Err("oauth details are only allowed when type is \"oauth2\"".into());
    }
    Ok(())
}

/// Error for a skill name that is not slug-safe (it becomes a directory name on install).
fn invalid_skill_name(name: &str) -> String {
    format!(
        "invalid skill name \"{name}\": must be slug-safe (lowercase letters, digits, hyphens; start with a letter or digit), e.g. \"release-notes\""
    )
}

/// Extract host from a URL string (handles https:// and http://).
fn extract_host(url: &str) -> Option<String> {
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = without_scheme.split('/').next()?;
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

/// MCP catalog entry: server + optional credential
struct McpCatalogEntry {
    server: Value,
    credential: Option<Value>,
}

static CATALOG_DATA: OnceLock<Value> = OnceLock::new();

fn catalog_data() -> &'static Value {
    CATALOG_DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../../fixtures/catalog-data.json"))
            .expect("catalog-data.json valid JSON")
    })
}

fn mcp_catalog_entry(id: &str) -> Option<McpCatalogEntry> {
    let entries = catalog_data()["mcp"].as_array()?;
    let entry = entries.iter().find(|e| e["id"].as_str() == Some(id))?;
    Some(McpCatalogEntry {
        server: entry["server"].clone(),
        credential: if entry
            .get("credential")
            .map(|c| !c.is_null())
            .unwrap_or(false)
        {
            Some(entry["credential"].clone())
        } else {
            None
        },
    })
}

/// Channel catalog entry: channel + credential
struct ChannelCatalogEntry {
    channel: Value,
    credential: Value,
}

fn channel_catalog_entry(id: &str) -> Option<ChannelCatalogEntry> {
    let entries = catalog_data()["channels"].as_array()?;
    let entry = entries.iter().find(|e| e["id"].as_str() == Some(id))?;
    Some(ChannelCatalogEntry {
        channel: entry["channel"].clone(),
        credential: entry["credential"].clone(),
    })
}

/// Look up a skill by name in a catalog JSON value.
/// Returns `(name, skill_md)` if found, `None` otherwise.
/// The catalog must have a `"skills"` array whose entries have `"name"` and `"skillMd"` fields.
pub fn skill_from_catalog(catalog: &Value, name: &str) -> Option<(String, String)> {
    let entries = catalog["skills"].as_array()?;
    let entry = entries.iter().find(|e| e["name"].as_str() == Some(name))?;
    let skill_md = entry["skillMd"].as_str()?;
    Some((name.to_string(), skill_md.to_string()))
}

// Shared with `load` (which holds the other bundle paths).
const POLICIES: &str = "identity/policies.md";
const MEMORY_KINDS: [&str; 5] = ["fact", "decision", "preference", "milestone", "episodic"];

/// One bundle file across the IPC boundary: its bundle path and base64 bytes.
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BundleFile {
    pub path: String,
    pub bytes_base64: String,
}

/// Unpack a `.uniqent` and check its signature: `"valid"` or `"unsigned"`. A signed bundle whose
/// signature no longer matches is refused, never opened.
pub fn open_bundle_bytes(bytes: &[u8]) -> Result<(Bundle, &'static str), String> {
    let bundle = unpack(bytes)?;
    let v = verify(&bundle);
    if !v.signed {
        return Ok((bundle, "unsigned"));
    }
    if v.valid {
        return Ok((bundle, "valid"));
    }
    Err(format!(
        "signature is INVALID ({}): the bundle changed after signing; refusing to open",
        v.reason.as_deref().unwrap_or("invalid signature")
    ))
}

pub struct Session {
    name: String,
    display_name: String,
    description: String,
    version: String,
    targets: Vec<String>,
    persona: Option<String>,
    policies: Option<String>, // identity/policies.md, passed through (no editor yet)
    readme: Option<String>,
    avatar: Option<String>, // data: URL, validated on set
    keypair: Option<Keypair>,
    // Content collections
    mcp: Vec<Value>,               // MCP server objects stored verbatim
    credentials: Vec<Value>,       // credentials, deduped by ref
    skills: Vec<(String, String)>, // (name, markdown) ordered
    channels: Vec<Value>,          // channel objects
    tasks: Vec<Value>,             // task objects
    facts: Vec<Value>,             // fact objects (with createdAt for bundle)
    profile: Option<Value>,        // profile object or None
    fact_counter: u32,
    task_counter: u32,
    hub_index_urls: Vec<String>, // extra JSON-index hub URLs (https only)
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

impl Session {
    pub fn new() -> Self {
        Session {
            name: "my-brain".into(),
            display_name: "My Brain".into(),
            description: "A portable agent brain.".into(),
            version: "0.1.0".into(),
            targets: vec![],
            persona: None,
            policies: None,
            readme: None,
            avatar: None,
            keypair: None,
            mcp: vec![],
            credentials: vec![],
            skills: vec![],
            channels: vec![],
            tasks: vec![],
            facts: vec![],
            profile: None,
            fact_counter: 0,
            task_counter: 0,
            hub_index_urls: vec![],
        }
    }

    /// Add a credential, deduped by ref (remove old, append new).
    fn add_credential(&mut self, cred: Value) {
        let cred_ref = cred["ref"].as_str().unwrap_or("").to_string();
        self.credentials
            .retain(|c| c["ref"].as_str().unwrap_or("") != cred_ref);
        self.credentials.push(cred);
    }

    /// Add MCP server from catalog by id. Returns Err if id not found.
    pub fn add_mcp_catalog(&mut self, id: &str) -> Result<(), String> {
        let entry =
            mcp_catalog_entry(id).ok_or_else(|| format!("MCP catalog id not found: {id}"))?;
        // Dedup by id: remove old, append new
        self.mcp.retain(|s| s["id"].as_str().unwrap_or("") != id);
        self.mcp.push(entry.server);
        if let Some(cred) = entry.credential {
            self.add_credential(cred);
        }
        Ok(())
    }

    /// Add a hub search result: its server plus every credential it declares. All credentials are
    /// validated first (spec CredentialRequirement shape); on any error nothing changes.
    pub fn add_mcp_hub_result(
        &mut self,
        server: Value,
        credentials: Vec<Value>,
    ) -> Result<(), String> {
        for (i, c) in credentials.iter().enumerate() {
            validate_credential(c).map_err(|e| format!("credentials[{i}]: {e}"))?;
        }
        self.add_custom_mcp(server)?;
        for c in credentials {
            self.add_credential(c);
        }
        Ok(())
    }

    /// Extra JSON-index hub URLs searched alongside the built-in hubs.
    pub fn hub_indexes(&self) -> Vec<String> {
        self.hub_index_urls.clone()
    }

    /// Replace the JSON-index hub URLs: trimmed, https only, deduped in order.
    pub fn set_hub_indexes(&mut self, urls: Vec<String>) -> Result<Vec<String>, String> {
        let mut kept: Vec<String> = vec![];
        for url in urls {
            let url = url.trim().to_string();
            if !url.starts_with("https://") {
                return Err(format!("hub index URLs must use https://, got {url}"));
            }
            if !kept.contains(&url) {
                kept.push(url);
            }
        }
        self.hub_index_urls = kept.clone();
        Ok(kept)
    }

    /// The brain's memory facts (bundle shape), e.g. to read provenance.
    pub fn memory_items(&self) -> Vec<Value> {
        self.facts.clone()
    }

    /// The memory-pack upload for the hub: shareable facts only (personal ones never leave).
    /// Refuses when a shareable fact looks like it holds a secret, naming the fact ids.
    pub fn publish_payload(&self) -> Result<Value, String> {
        let shareable: Vec<&Value> = self
            .facts
            .iter()
            .filter(|f| f["visibility"].as_str() != Some("personal"))
            .collect();
        if shareable.is_empty() {
            return Err("no shareable memory to publish".into());
        }
        let leaking: Vec<&str> = shareable
            .iter()
            .filter(|f| is_likely_secret_value(f["text"].as_str().unwrap_or("")))
            .map(|f| f["id"].as_str().unwrap_or("?"))
            .collect();
        if !leaking.is_empty() {
            return Err(format!(
                "refusing to publish: fact {} looks like it contains a secret — remove or rewrite it first",
                leaking.join(", ")
            ));
        }
        let facts: Vec<Value> = shareable
            .iter()
            .map(|f| json!({ "kind": f["kind"], "text": f["text"] }))
            .collect();
        let m = &self.state()["manifest"];
        Ok(json!({
            "slug": m["name"],
            "name": m["displayName"],
            "description": m["description"],
            "tags": m["tags"],
            "facts": facts,
        }))
    }

    /// Add custom MCP server. Merges tools:{include:'all'} as default.
    /// Errors (adding nothing) when the result is not a spec McpServer, naming the field.
    pub fn add_custom_mcp(&mut self, input: Value) -> Result<(), String> {
        // Build server: start with tools default, then overlay input fields
        let mut server = json!({"tools": {"include": "all"}});
        if let (Value::Object(base), Value::Object(extra)) = (&mut server, input) {
            for (k, v) in extra {
                base.insert(k, v);
            }
        }
        if let Some(problem) = load::mcp_server_problem(&server) {
            return Err(format!("custom MCP server: {problem}"));
        }
        let id = server["id"].as_str().unwrap_or_default().to_string();

        // Dedup by id: remove old, append new
        self.mcp.retain(|s| s["id"].as_str().unwrap_or("") != id);
        self.mcp.push(server.clone());

        // Add credential if auth has a credentialRef
        if let Some(cred_ref) = server["auth"]["credentialRef"].as_str() {
            if !cred_ref.is_empty() {
                let cred = json!({
                    "ref": cred_ref,
                    "label": cred_ref,
                    "type": "apiKey",
                    "consumedBy": [],
                    "required": true,
                    "help": ""
                });
                self.add_credential(cred);
            }
        }

        Ok(())
    }

    /// Components currently using credential `cred_ref`: MCP servers whose auth references it
    /// and channels whose credentialRef names it (e.g. `["channel:slack", "mcp:github"]`).
    fn live_consumers(&self, cred_ref: &str) -> Vec<String> {
        let mut consumers: Vec<String> = Vec::new();
        // A server consumes a ref via auth or a ${credentialRef:…} placeholder (env, headers, args),
        // like syncedCredentials in packages/builder/src/brain.ts.
        let placeholder = format!("${{credentialRef:{cred_ref}}}");
        for server in &self.mcp {
            if server["auth"]["credentialRef"].as_str() == Some(cred_ref)
                || server.to_string().contains(&placeholder)
            {
                if let Some(sid) = server["id"].as_str() {
                    consumers.push(format!("mcp:{sid}"));
                }
            }
        }
        for channel in &self.channels {
            if channel["credentialRef"].as_str() == Some(cred_ref) {
                if let Some(cid) = channel["id"].as_str() {
                    consumers.push(format!("channel:{cid}"));
                }
            }
        }
        consumers
    }

    /// Every consumer of a credential: its declared consumedBy plus live references, sorted.
    fn consumers_of(&self, cred: &Value) -> Vec<String> {
        let mut all: Vec<String> = cred["consumedBy"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        all.extend(self.live_consumers(cred["ref"].as_str().unwrap_or("")));
        all.sort();
        all.dedup();
        all
    }

    /// Remove a component via `remove` and release its credentials: `consumer` is dropped from
    /// every credential it used, and a credential left with no consumer is removed.
    fn remove_consumer(&mut self, consumer: &str, remove: impl FnOnce(&mut Self)) {
        let before: Vec<(Value, Vec<String>)> = self
            .credentials
            .iter()
            .map(|c| (c.clone(), self.consumers_of(c)))
            .collect();
        remove(self);
        for (cred, consumers) in before {
            if !consumers.iter().any(|c| c == consumer) {
                continue;
            }
            let remaining: Vec<String> = consumers.into_iter().filter(|c| c != consumer).collect();
            let cred_ref = cred["ref"].as_str().unwrap_or("").to_string();
            if remaining.is_empty() {
                self.credentials
                    .retain(|c| c["ref"].as_str().unwrap_or("") != cred_ref);
            } else {
                let mut kept = cred;
                kept["consumedBy"] = json!(remaining);
                self.add_credential(kept);
            }
        }
    }

    /// Remove MCP server by id, dropping credentials only it used.
    pub fn remove_mcp(&mut self, id: &str) {
        self.remove_consumer(&format!("mcp:{id}"), |s| {
            s.mcp.retain(|srv| srv["id"].as_str().unwrap_or("") != id)
        });
    }

    /// Add custom skill by name + markdown content. The name must be slug-safe and unused:
    /// an existing skill is never overwritten (remove it first to replace it).
    pub fn add_custom_skill(&mut self, name: &str, skill_md: &str) -> Result<(), String> {
        if !is_valid_slug(name) {
            return Err(invalid_skill_name(name));
        }
        if self.skills.iter().any(|(n, _)| n == name) {
            return Err(format!(
                "a skill named \"{name}\" is already in this brain; remove it first to replace it"
            ));
        }
        self.skills.push((name.to_string(), skill_md.to_string()));
        Ok(())
    }

    /// Remove skill by name.
    pub fn remove_skill(&mut self, name: &str) {
        self.skills.retain(|(n, _)| n != name);
    }

    /// Add skill from catalog by name. Returns Err if name not found.
    pub fn add_skill_catalog(&mut self, name: &str) -> Result<(), String> {
        let (skill_name, skill_md) = skill_from_catalog(catalog_data(), name)
            .ok_or_else(|| format!("skill catalog name not found: {name}"))?;
        // Dedup by name: remove old, append new (same as add_custom_skill)
        self.skills.retain(|(n, _)| n != &skill_name);
        self.skills.push((skill_name, skill_md));
        Ok(())
    }

    /// Add channel from catalog by id. Returns Err if id not found.
    pub fn add_channel_catalog(&mut self, id: &str) -> Result<(), String> {
        let entry = channel_catalog_entry(id)
            .ok_or_else(|| format!("channel catalog id not found: {id}"))?;
        // Dedup by id: remove old, append new
        self.channels
            .retain(|c| c["id"].as_str().unwrap_or("") != id);
        self.channels.push(entry.channel);
        self.add_credential(entry.credential);
        Ok(())
    }

    /// Remove channel by id, dropping credentials only it used.
    pub fn remove_channel(&mut self, id: &str) {
        self.remove_consumer(&format!("channel:{id}"), |s| {
            s.channels.retain(|c| c["id"].as_str().unwrap_or("") != id)
        });
    }

    /// Add a task. Input may have: name, triggerType (schedule|event|manual, default schedule),
    /// cron (required + validated for schedule), event (required for event), prompt, enabled.
    /// Nothing changes on error.
    pub fn add_task(&mut self, input: Value) -> Result<(), String> {
        let trigger_type = match input.get("triggerType") {
            None | Some(Value::Null) => "schedule",
            Some(v) => v.as_str().unwrap_or(""),
        };
        let trigger = match trigger_type {
            "schedule" => {
                let cron = input["cron"].as_str().unwrap_or("").trim().to_string();
                let problem = if cron.is_empty() {
                    Some("a cron expression is required".to_string())
                } else {
                    cron_problem(&cron)
                };
                if let Some(p) = problem {
                    return Err(format!(
                        "invalid cron \"{cron}\": {p} — e.g. \"0 9 * * *\" (daily at 09:00)"
                    ));
                }
                json!({"type": "schedule", "cron": cron})
            }
            "event" => {
                let event = input["event"].as_str().unwrap_or("").trim().to_string();
                if event.is_empty() {
                    return Err("an event trigger needs an event name".into());
                }
                json!({"type": "event", "event": event})
            }
            "manual" => json!({"type": "manual"}),
            other => {
                return Err(format!(
                    "invalid triggerType \"{other}\": expected schedule, event or manual"
                ))
            }
        };

        self.task_counter += 1;
        let id = format!("task-{}", self.task_counter);
        let name = match input["name"].as_str().map(str::trim) {
            Some(n) if !n.is_empty() => n.to_string(),
            _ => id.clone(),
        };

        let enabled = input["enabled"].as_bool().unwrap_or(true);

        let mut task = json!({
            "id": id,
            "name": name,
            "trigger": trigger,
            "action": {
                "kind": "prompt"
            },
            "enabled": enabled
        });

        if let Some(prompt) = input["prompt"].as_str() {
            task["action"]["prompt"] = json!(prompt);
        }

        self.tasks.push(task);
        Ok(())
    }

    /// Remove task by id.
    pub fn remove_task(&mut self, id: &str) {
        self.tasks.retain(|t| t["id"].as_str().unwrap_or("") != id);
    }

    /// The next generated fact id (`fact-N`) that no existing fact uses (e.g. an imported id).
    fn next_fact_id(&mut self) -> String {
        loop {
            self.fact_counter += 1;
            let id = format!("fact-{}", self.fact_counter);
            if !self
                .facts
                .iter()
                .any(|f| f["id"].as_str() == Some(id.as_str()))
            {
                return id;
            }
        }
    }

    /// Add a fact: non-empty text, optional importance in 0..=1, optional visibility.
    pub fn add_fact(&mut self, input: Value) -> Result<(), String> {
        let text = input["text"].as_str().unwrap_or("");
        if text.is_empty() {
            return Err("memory text is required".into());
        }
        let importance = validate_importance(input.get("importance"), "importance")?;
        let visibility = validate_visibility(input.get("visibility"), "visibility")?;

        let mut fact = json!({
            "id": self.next_fact_id(),
            "kind": "fact",
            "text": text,
            "createdAt": now_iso()
        });
        if let Some(i) = importance {
            fact["importance"] = i;
        }
        if let Some(v) = visibility {
            fact["visibility"] = json!(v);
        }

        self.facts.push(fact);
        Ok(())
    }

    /// Set profile: an object of text fields with distinct (trimmed) names. Names and values are
    /// trimmed; fields `profile_field_kept` rejects are dropped; an empty profile clears it.
    /// Errors (changing nothing) on any other shape.
    pub fn set_profile(&mut self, profile: Value) -> Result<(), String> {
        let Value::Object(map) = profile else {
            return Err(format!(
                "profile must be an object of text fields, got {}",
                json_type(&profile)
            ));
        };
        let mut seen: Vec<String> = Vec::new();
        for (k, v) in &map {
            if !v.is_string() {
                return Err(format!(
                    "profile field \"{k}\" must be text, got {}",
                    json_type(v)
                ));
            }
            let key = k.trim().to_string();
            if seen.contains(&key) {
                return Err(format!("duplicate profile field \"{key}\""));
            }
            seen.push(key);
        }
        let cleaned: Map<String, Value> = map
            .iter()
            .filter_map(|(k, v)| {
                let value = v.as_str().unwrap_or("");
                profile_field_kept(k, value).then(|| (k.trim().to_string(), json!(value.trim())))
            })
            .collect();
        self.profile = if cleaned.is_empty() {
            None
        } else {
            Some(Value::Object(cleaned))
        };
        Ok(())
    }

    /// Get profile. Returns {} if none set.
    pub fn get_profile(&self) -> Value {
        self.profile.clone().unwrap_or_else(|| json!({}))
    }

    pub fn state(&self) -> Value {
        let identity = self.persona.is_some();

        // Build sorted skill names
        let mut skill_names: Vec<String> = self.skills.iter().map(|(n, _)| n.clone()).collect();
        skill_names.sort();

        // Build sorted mcp ids
        let mut mcp_ids: Vec<String> = self
            .mcp
            .iter()
            .filter_map(|s| s["id"].as_str().map(|s| s.to_string()))
            .collect();
        mcp_ids.sort();

        // Build sorted task ids
        let mut task_ids: Vec<String> = self
            .tasks
            .iter()
            .filter_map(|t| t["id"].as_str().map(|s| s.to_string()))
            .collect();
        task_ids.sort();

        // Build sorted channel ids
        let mut channel_ids: Vec<String> = self
            .channels
            .iter()
            .filter_map(|c| c["id"].as_str().map(|s| s.to_string()))
            .collect();
        channel_ids.sort();

        // Compute consumedBy for each credential (synced dynamically)
        let credentials_state: Vec<Value> = self
            .credentials
            .iter()
            .map(|cred| {
                // Declared + live consumers; optional fields only when present (the TS schema
                // rejects null for them).
                let mut out = json!({
                    "ref": cred["ref"],
                    "label": cred["label"],
                    "type": cred["type"],
                    "consumedBy": self.consumers_of(cred),
                    "required": cred["required"],
                });
                for key in ["help", "oauth"] {
                    if let Some(v) = cred.get(key).filter(|v| !v.is_null()) {
                        out[key] = v.clone();
                    }
                }
                out
            })
            .collect();

        // Compute network endpoints (unique hosts from mcp servers with url field, sorted)
        let mut endpoints: Vec<String> = self
            .mcp
            .iter()
            .filter_map(|s| s["url"].as_str().and_then(extract_host))
            .collect();
        endpoints.sort();
        endpoints.dedup();

        // spawnsProcesses: any mcp server has transport == "stdio"
        let spawns_processes = self
            .mcp
            .iter()
            .any(|s| s["transport"].as_str() == Some("stdio"));

        let manifest = json!({
            "specVersion": "0.1",
            "name": self.name,
            "displayName": self.display_name,
            "version": self.version,
            "description": self.description,
            "author": { "name": "Anonymous" },
            "license": "CC0-1.0",
            "tags": [],
            "components": {
                "identity": identity,
                "memory": {
                    "facts": self.facts.len(),
                    "episodic": 0,
                    "hasProfile": self.profile.is_some()
                },
                "skills": skill_names,
                "mcp": mcp_ids,
                "tools": [],
                "tasks": task_ids,
                "channels": channel_ids
            },
            "credentials": credentials_state,
            "permissions": {
                "filesystem": {
                    "read": [],
                    "write": []
                },
                "network": {
                    "endpoints": endpoints
                },
                "autonomy": "suggest",
                "spawnsProcesses": spawns_processes
            },
            "compatibility": {
                "targets": self.targets
            }
        });

        let validation = validate_manifest(&self.name, &self.version);

        let mut map = Map::new();
        map.insert("manifest".into(), manifest);
        map.insert("validation".into(), validation);
        if let Some(p) = &self.persona {
            map.insert("persona".into(), Value::String(p.clone()));
        }
        if let Some(r) = &self.readme {
            map.insert("readme".into(), Value::String(r.clone()));
        }
        if let Some(a) = &self.avatar {
            map.insert("avatar".into(), Value::String(a.clone()));
        }
        Value::Object(map)
    }

    pub fn catalog(&self) -> Value {
        serde_json::from_str(include_str!("../../fixtures/catalog.json"))
            .expect("catalog.json valid")
    }

    /// Update brain metadata. Every present field is validated first (like the TS
    /// `Brain.setMeta`); on the first invalid one this returns an error and changes nothing.
    pub fn set_meta(&mut self, meta: Value) -> Result<(), String> {
        let text = |key: &str| -> Result<Option<String>, String> {
            match meta.get(key) {
                None => Ok(None),
                Some(Value::String(v)) => Ok(Some(v.clone())),
                Some(other) => Err(format!(
                    "invalid brain meta \"{key}\": expected a string, got {other}"
                )),
            }
        };
        let name = text("name")?;
        let display_name = text("displayName")?;
        let description = text("description")?;
        let version = text("version")?;
        if let Some(n) = &name {
            if !is_valid_slug(n) {
                return Err(format!(
                    "invalid brain meta \"name\": must be slug-safe (lowercase letters, digits, hyphens), got \"{n}\""
                ));
            }
        }
        if display_name.as_deref() == Some("") {
            return Err("invalid brain meta \"displayName\": must not be empty".into());
        }
        if let Some(v) = &version {
            if !is_valid_semver(v) {
                return Err(format!(
                    "invalid brain meta \"version\": must be a valid semver (e.g. 1.2.3), got \"{v}\""
                ));
            }
        }
        if let Some(n) = name {
            self.name = n;
        }
        if let Some(d) = display_name {
            self.display_name = d;
        }
        if let Some(d) = description {
            self.description = d;
        }
        if let Some(v) = version {
            self.version = v;
        }
        Ok(())
    }

    pub fn set_targets(&mut self, targets: Vec<String>) {
        self.targets = targets;
    }

    pub fn set_persona(&mut self, md: String) {
        // Mirror TS Brain.setPersona: stores verbatim (including ""), key stays present.
        // identity = persona.is_some(), so set_persona("") → identity: true.
        self.persona = Some(md);
    }

    pub fn set_readme(&mut self, md: String) {
        // Mirror TS Brain.setReadme: trim-empty clears (whitespace-only drops the key).
        if md.trim().is_empty() {
            self.readme = None;
        } else {
            self.readme = Some(md);
        }
    }

    pub fn set_avatar(&mut self, data_url: String) -> Result<(), String> {
        // Phase 1 intentionally accepts only png/jpeg/webp (TS also allows gif/svg; parity deferred to a later phase).
        let trimmed = data_url.trim();

        // Check supported prefixes
        let prefix_and_b64 = trimmed
            .strip_prefix("data:image/png;base64,")
            .or_else(|| trimmed.strip_prefix("data:image/jpeg;base64,"))
            .or_else(|| trimmed.strip_prefix("data:image/webp;base64,"));

        match prefix_and_b64 {
            None => Err("unsupported avatar format".into()),
            Some(b64) => {
                // Decode to check size
                let decoded = base64::engine::general_purpose::STANDARD_NO_PAD
                    .decode(b64)
                    .or_else(|_| base64::engine::general_purpose::STANDARD.decode(b64))
                    .map_err(|_| "unsupported avatar format".to_string())?;

                if decoded.len() > 512 * 1024 {
                    return Err("avatar too large (max 512KB)".into());
                }
                self.avatar = Some(trimmed.to_string());
                Ok(())
            }
        }
    }

    pub fn remove_avatar(&mut self) {
        self.avatar = None;
    }

    /// Build a Bundle from the current session state.
    /// manifest JSON = the same manifest value state() emits, plus optional files.
    fn build_bundle(&self) -> Result<Bundle, String> {
        let state = self.state();
        let manifest_value = &state["manifest"];
        let manifest_json =
            serde_json::to_string_pretty(manifest_value).expect("manifest serialises");

        let mut bundle = Bundle::default();
        bundle.set("uniqent.json", manifest_json.into_bytes())?;

        if let Some(readme) = &self.readme {
            if !readme.trim().is_empty() {
                bundle.set("README.md", readme.as_bytes().to_vec())?;
            }
        }
        if let Some(persona) = &self.persona {
            bundle.set("identity/persona.md", persona.as_bytes().to_vec())?;
        }
        if let Some(policies) = &self.policies {
            bundle.set(POLICIES, policies.as_bytes().to_vec())?;
        }
        if let Some(data_url) = &self.avatar {
            // Parse data:<mime>;base64,<b64> to extract ext + raw bytes
            if let Some(rest) = data_url.strip_prefix("data:image/") {
                if let Some(semi_pos) = rest.find(';') {
                    let raw_ext = &rest[..semi_pos];
                    let ext = raw_ext.to_lowercase();
                    let ext = if ext == "jpeg" { "jpg" } else { &ext };
                    if let Some(b64) = rest[semi_pos..].strip_prefix(";base64,") {
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD
                            .decode(b64)
                            .or_else(|_| {
                                base64::engine::general_purpose::STANDARD_NO_PAD.decode(b64)
                            })
                        {
                            bundle.set(&format!("avatar.{ext}"), bytes)?;
                        }
                    }
                }
            }
        }

        // MCP servers
        if !self.mcp.is_empty() {
            let servers_json = serde_json::to_string_pretty(&json!({"servers": self.mcp}))
                .expect("mcp serialises");
            bundle.set("mcp/servers.json", servers_json.into_bytes())?;
        }

        // Skills
        for (name, md) in &self.skills {
            bundle.set(&format!("skills/{name}/SKILL.md"), md.as_bytes().to_vec())?;
        }

        // Channels
        if !self.channels.is_empty() {
            let channels_json = serde_json::to_string_pretty(&json!({"channels": self.channels}))
                .expect("channels serialises");
            bundle.set("channels/channels.json", channels_json.into_bytes())?;
        }

        // Tasks
        for task in &self.tasks {
            let id = task["id"].as_str().unwrap_or("task");
            let task_json = serde_json::to_string_pretty(task).expect("task serialises");
            bundle.set(&format!("tasks/{id}.json"), task_json.into_bytes())?;
        }

        // Facts (JSONL format — each fact on its own line, trailing newline)
        if !self.facts.is_empty() {
            let mut facts_jsonl = String::new();
            for fact in &self.facts {
                facts_jsonl.push_str(&serde_json::to_string(fact).expect("fact serialises"));
                facts_jsonl.push('\n');
            }
            bundle.set("memory/facts.jsonl", facts_jsonl.into_bytes())?;
        }

        // Profile
        if let Some(profile) = &self.profile {
            let profile_json = serde_json::to_string_pretty(profile).expect("profile serialises");
            bundle.set("memory/profile.json", profile_json.into_bytes())?;
        }

        Ok(bundle)
    }

    /// Export the current brain as a signed or unsigned .uniqent bundle.
    ///
    /// NOTE: validation is Phase 1's subset (see pack_checked); full assertValid parity
    /// with TS pack is deferred to Phase 3.
    pub fn export(&mut self, sign_it: bool) -> Result<Value, String> {
        let state = self.state();
        let validation = state["validation"].clone();

        let (final_bundle, signed) = if sign_it {
            (self.signed_bundle()?, true)
        } else {
            (self.build_bundle()?, false)
        };

        let bytes = pack_checked(&final_bundle)?;
        let verified = if signed {
            verify(&final_bundle).valid
        } else {
            false
        };
        let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

        Ok(json!({
            "filename": self.file_name(),
            "bytesBase64": bytes_b64,
            "signed": signed,
            "verified": verified,
            "validation": validation,
        }))
    }

    /// The bundle's file name: `<name>.uniqent`.
    pub fn file_name(&self) -> String {
        format!("{}.uniqent", self.name)
    }

    /// The current brain signed with the session keypair (created on first use).
    fn signed_bundle(&mut self) -> Result<Bundle, String> {
        if self.keypair.is_none() {
            self.keypair = Some(generate_keypair()?);
        }
        let kp = self.keypair.as_ref().unwrap();
        sign(&self.build_bundle()?, &kp.private_key)
    }

    /// The signed, packed `.uniqent` bytes (what `export(true)` returns as base64).
    pub fn signed_bytes(&mut self) -> Result<Vec<u8>, String> {
        pack_checked(&self.signed_bundle()?)
    }

    /// The current draft as an unsigned bundle, one entry per file.
    pub fn bundle_files(&self) -> Result<Vec<BundleFile>, String> {
        Ok(self
            .build_bundle()?
            .entries()
            .map(|(path, bytes)| BundleFile {
                path: path.clone(),
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
            })
            .collect())
    }

    pub fn reset(&mut self) {
        *self = Session::new();
    }

    /// Preview a pasted MCP config without mutating state.
    pub fn paste_mcp_preview(&self, text: &str) -> Value {
        use crate::ports::mcp_normalize::normalize_mcp_config;
        let parsed: Value = match serde_json::from_str(text) {
            Ok(v) => v,
            Err(_) => {
                return json!({
                    "servers": [],
                    "credentials": [],
                    "lossiness": ["not valid JSON"]
                });
            }
        };
        normalize_mcp_config(&parsed)
    }

    /// Add a pasted MCP config. Returns count of servers added.
    pub fn add_pasted_mcp(&mut self, text: &str) -> Result<usize, String> {
        use crate::ports::mcp_normalize::normalize_mcp_config;
        let parsed: Value = serde_json::from_str(text).map_err(|_| "not valid JSON".to_string())?;
        let result = normalize_mcp_config(&parsed);
        let servers = result["servers"].as_array().cloned().unwrap_or_default();
        let credentials = result["credentials"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for s in &servers {
            self.mcp
                .retain(|existing| existing["id"].as_str() != s["id"].as_str());
            self.mcp.push(s.clone());
        }
        for c in credentials {
            self.add_credential(c);
        }
        Ok(servers.len())
    }

    /// Import memory from `{markdown?, text?, items?}` payload.
    ///
    /// Priority:
    ///   1. `items` array  → importItems semantics (kind/text/id preserved; blanks skipped)
    ///   2. `markdown` string → parseMemoryMarkdown (kind inferred from prefix; links/tags kept)
    ///   3. `text` string → importLines (plain newline-split, each non-empty line = one fact)
    ///
    /// Returns the count of items added.
    pub fn import_memory(&mut self, payload: Value) -> Result<usize, String> {
        use crate::ports::memory::parse_memory_markdown;

        if let Some(items) = payload["items"].as_array() {
            // importItems semantics: every item is validated first (text must be a string, kind
            // known, importance 0..=1, ids unique); blank text is skipped; nothing changes on error.
            let mut used: Vec<String> = self
                .facts
                .iter()
                .filter_map(|f| f["id"].as_str().map(String::from))
                .collect();
            let mut pending: Vec<(Option<String>, Value)> = Vec::new();
            for (i, raw) in items.iter().enumerate() {
                let Some(text) = raw["text"].as_str() else {
                    return Err(format!(
                        "items[{i}].text must be a string, got {}",
                        raw["text"]
                    ));
                };
                let text = text.trim().to_string();
                let kind = match raw.get("kind") {
                    None | Some(Value::Null) => "fact",
                    Some(k) => k.as_str().filter(|k| MEMORY_KINDS.contains(k)).ok_or_else(|| {
                        format!(
                            "items[{i}].kind must be one of fact, decision, preference, milestone, episodic, got {k}"
                        )
                    })?,
                };
                let importance =
                    validate_importance(raw.get("importance"), &format!("items[{i}].importance"))?;
                let visibility =
                    validate_visibility(raw.get("visibility"), &format!("items[{i}].visibility"))?;
                if text.is_empty() {
                    continue;
                }
                let id = raw["id"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .map(String::from);
                if let Some(id) = &id {
                    if used.contains(id) {
                        return Err(format!(
                            "duplicate memory id \"{id}\": memory item ids must be unique"
                        ));
                    }
                    used.push(id.clone());
                }
                let mut fact = json!({
                    "kind": kind,
                    "text": text,
                    "createdAt": raw["createdAt"].as_str().map(String::from).unwrap_or_else(now_iso)
                });
                if let Some(imp) = importance {
                    fact["importance"] = imp;
                }
                if visibility == Some("personal") {
                    fact["visibility"] = json!("personal");
                }
                match raw.get("source") {
                    None | Some(Value::Null) => {}
                    Some(Value::String(src)) => fact["source"] = json!(src),
                    Some(other) => {
                        return Err(format!("items[{i}].source must be a string, got {other}"))
                    }
                }
                pending.push((id, fact));
            }
            let added = pending.len();
            for (id, mut fact) in pending {
                let id = match id {
                    Some(id) => id,
                    None => loop {
                        let candidate = self.next_fact_id();
                        if !used.contains(&candidate) {
                            break candidate;
                        }
                    },
                };
                fact["id"] = json!(id);
                self.facts.push(fact);
            }
            return Ok(added);
        }

        if let Some(markdown) = payload["markdown"].as_str() {
            // importMarkdown semantics: parse with kind/entity/tag extraction
            let parsed = parse_memory_markdown(markdown);
            let items = parsed.as_array().cloned().unwrap_or_default();
            let n = items.len();
            for it in items {
                let fact = json!({
                    "id": self.next_fact_id(),
                    "kind": it["kind"],
                    "text": it["text"],
                    "createdAt": now_iso()
                });
                self.facts.push(fact);
            }
            return Ok(n);
        }

        if let Some(text) = payload["text"].as_str() {
            // importLines semantics: split by newline, trim, skip blanks
            let lines: Vec<&str> = text
                .split('\n')
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .collect();
            let n = lines.len();
            for line in lines {
                let fact = json!({
                    "id": self.next_fact_id(),
                    "kind": "fact",
                    "text": line,
                    "createdAt": now_iso()
                });
                self.facts.push(fact);
            }
            return Ok(n);
        }

        Ok(0)
    }

    /// Preview a memory import: parse markdown into items + build graph, WITHOUT mutating state.
    /// Returns `{ items: ImportedMemoryItem[], graph: MemoryGraph }`.
    pub fn preview_memory(&self, text: &str) -> Value {
        use crate::ports::memory::{memory_graph, parse_memory_markdown};

        let parsed = parse_memory_markdown(text);
        let items = parsed.as_array().cloned().unwrap_or_default();
        // Build graph input: id = p{i}, text, kind
        let graph_input: Vec<Value> = items
            .iter()
            .enumerate()
            .map(|(i, it)| {
                json!({
                    "id": format!("p{i}"),
                    "text": it["text"],
                    "kind": it["kind"]
                })
            })
            .collect();
        let graph = memory_graph(&Value::Array(graph_input));
        json!({ "items": items, "graph": graph })
    }

    /// Return the memory knowledge graph from current session facts.
    /// Each fact contributes its id, text, and kind.
    pub fn memory_graph(&self) -> Value {
        use crate::ports::memory::memory_graph;

        let input: Vec<Value> = self
            .facts
            .iter()
            .map(|f| {
                json!({
                    "id": f["id"],
                    "text": f["text"],
                    "kind": f["kind"]
                })
            })
            .collect();
        memory_graph(&Value::Array(input))
    }

    /// Import MCP servers from a JSON array of any shape. Raw server objects are normalized as ONE
    /// batch so unnamed or alike-named ones get distinct ids (`-2`, `-3`); canonical servers and
    /// whole config blobs are normalized on their own. Errors, adding nothing, when two imported
    /// servers still share an id. Returns the server count.
    pub fn import_mcp_servers(&mut self, servers: Value) -> Result<usize, String> {
        use crate::ports::mcp_normalize::normalize_mcp_config;
        let arr = servers
            .as_array()
            .ok_or_else(|| "servers must be an array".to_string())?;
        let is_raw_server = |s: &Value| {
            !(s["id"].is_string() && s["transport"].is_string())
                && s.get("mcpServers").is_none()
                && s.get("servers").is_none()
        };
        let mut results: Vec<Value> = arr
            .iter()
            .filter(|s| !is_raw_server(s))
            .map(normalize_mcp_config)
            .collect();
        let raw: Vec<Value> = arr.iter().filter(|s| is_raw_server(s)).cloned().collect();
        results.push(normalize_mcp_config(&json!({ "servers": raw })));

        let mut ids: Vec<String> = Vec::new();
        for server in results
            .iter()
            .flat_map(|r| r["servers"].as_array().cloned().unwrap_or_default())
        {
            let id = server["id"].as_str().unwrap_or("").to_string();
            if ids.contains(&id) {
                return Err(format!(
                    "two imported MCP servers share the id \"{id}\"; give each server a distinct id and import again"
                ));
            }
            ids.push(id);
        }
        for r in results {
            for s in r["servers"].as_array().cloned().unwrap_or_default() {
                self.mcp
                    .retain(|existing| existing["id"].as_str() != s["id"].as_str());
                self.mcp.push(s);
            }
            for c in r["credentials"].as_array().cloned().unwrap_or_default() {
                self.add_credential(c);
            }
        }
        Ok(ids.len())
    }
}
