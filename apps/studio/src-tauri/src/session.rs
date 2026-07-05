use base64::Engine;
use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

use crate::core::archive::pack_checked;
use crate::core::bundle::Bundle;
use crate::core::signing::{generate_keypair, sign, verify, Keypair};

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
        credential: if entry.get("credential").map(|c| !c.is_null()).unwrap_or(false) {
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

pub struct Session {
    name: String,
    display_name: String,
    description: String,
    version: String,
    targets: Vec<String>,
    persona: Option<String>,
    readme: Option<String>,
    avatar: Option<String>, // data: URL, validated on set
    keypair: Option<Keypair>,
    // Content collections
    mcp: Vec<Value>,                 // MCP server objects stored verbatim
    credentials: Vec<Value>,         // credentials, deduped by ref
    skills: Vec<(String, String)>,   // (name, markdown) ordered
    channels: Vec<Value>,            // channel objects
    tasks: Vec<Value>,               // task objects
    facts: Vec<Value>,               // fact objects (with createdAt for bundle)
    profile: Option<Value>,          // profile object or None
    fact_counter: u32,
    task_counter: u32,
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
        }
    }

    /// Add a credential, deduped by ref (remove old, append new).
    fn add_credential(&mut self, cred: Value) {
        let cred_ref = cred["ref"].as_str().unwrap_or("").to_string();
        self.credentials.retain(|c| c["ref"].as_str().unwrap_or("") != cred_ref);
        self.credentials.push(cred);
    }

    /// Add MCP server from catalog by id. Returns Err if id not found.
    pub fn add_mcp_catalog(&mut self, id: &str) -> Result<(), String> {
        let entry = mcp_catalog_entry(id).ok_or_else(|| format!("MCP catalog id not found: {id}"))?;
        // Dedup by id: remove old, append new
        self.mcp.retain(|s| s["id"].as_str().unwrap_or("") != id);
        self.mcp.push(entry.server);
        if let Some(cred) = entry.credential {
            self.add_credential(cred);
        }
        Ok(())
    }

    /// Add custom MCP server. Merges tools:{include:'all'} as default.
    pub fn add_custom_mcp(&mut self, input: Value) -> Result<(), String> {
        let id = input["id"]
            .as_str()
            .ok_or("custom MCP must have an id")?
            .to_string();

        // Build server: start with tools default, then overlay input fields
        let mut server = json!({"tools": {"include": "all"}});
        if let (Value::Object(base), Value::Object(extra)) = (&mut server, input.clone()) {
            for (k, v) in extra {
                base.insert(k, v);
            }
        }

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

    /// Remove MCP server by id.
    pub fn remove_mcp(&mut self, id: &str) {
        self.mcp.retain(|s| s["id"].as_str().unwrap_or("") != id);
        // Note: credentials are NOT removed when mcp is removed (consumedBy is recomputed dynamically)
    }

    /// Add custom skill by name + markdown content.
    pub fn add_custom_skill(&mut self, name: &str, skill_md: &str) {
        // Dedup by name: remove old, append new
        self.skills.retain(|(n, _)| n != name);
        self.skills.push((name.to_string(), skill_md.to_string()));
    }

    /// Remove skill by name.
    pub fn remove_skill(&mut self, name: &str) {
        self.skills.retain(|(n, _)| n != name);
    }

    /// Add skill from catalog by name. Returns Err if name not found.
    pub fn add_skill_catalog(&mut self, name: &str) -> Result<(), String> {
        let entries = catalog_data()["skills"]
            .as_array()
            .ok_or_else(|| "catalog skills missing".to_string())?;
        let entry = entries
            .iter()
            .find(|e| e["name"].as_str() == Some(name))
            .ok_or_else(|| format!("skill catalog name not found: {name}"))?;
        let skill_md = entry["skillMd"]
            .as_str()
            .ok_or_else(|| format!("skill catalog entry missing skillMd: {name}"))?;
        // Dedup by name: remove old, append new (same as add_custom_skill)
        self.skills.retain(|(n, _)| n != name);
        self.skills.push((name.to_string(), skill_md.to_string()));
        Ok(())
    }

    /// Add channel from catalog by id. Returns Err if id not found.
    pub fn add_channel_catalog(&mut self, id: &str) -> Result<(), String> {
        let entry = channel_catalog_entry(id)
            .ok_or_else(|| format!("channel catalog id not found: {id}"))?;
        // Dedup by id: remove old, append new
        self.channels.retain(|c| c["id"].as_str().unwrap_or("") != id);
        self.channels.push(entry.channel);
        self.add_credential(entry.credential);
        Ok(())
    }

    /// Remove channel by id.
    pub fn remove_channel(&mut self, id: &str) {
        self.channels.retain(|c| c["id"].as_str().unwrap_or("") != id);
    }

    /// Add a task. Input may have: name, cron, event, prompt, enabled.
    pub fn add_task(&mut self, input: Value) -> Result<(), String> {
        self.task_counter += 1;
        let id = format!("task-{}", self.task_counter);
        let name = input["name"]
            .as_str()
            .unwrap_or(&id)
            .to_string();

        let trigger = if let Some(cron) = input["cron"].as_str() {
            json!({"type": "schedule", "cron": cron})
        } else if let Some(event) = input["event"].as_str() {
            json!({"type": "event", "event": event})
        } else {
            json!({"type": "manual"})
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

    /// Add a fact.
    pub fn add_fact(&mut self, input: Value) -> Result<(), String> {
        self.fact_counter += 1;
        let id = format!("fact-{}", self.fact_counter);

        let mut fact = json!({
            "id": id,
            "kind": "fact",
            "text": input["text"],
            "createdAt": "1970-01-01T00:00:00.000Z"
        });

        if let Some(importance) = input.get("importance") {
            fact["importance"] = importance.clone();
        }
        if let Some(visibility) = input.get("visibility") {
            fact["visibility"] = visibility.clone();
        }

        self.facts.push(fact);
        Ok(())
    }

    /// Set profile. Cleans empty string values, stores if non-empty.
    pub fn set_profile(&mut self, profile: Value) {
        if let Value::Object(map) = profile {
            let cleaned: Map<String, Value> = map
                .into_iter()
                .filter(|(_, v)| v.as_str() != Some(""))
                .collect();
            if cleaned.is_empty() {
                self.profile = None;
            } else {
                self.profile = Some(Value::Object(cleaned));
            }
        } else {
            self.profile = None;
        }
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
        let credentials_state: Vec<Value> = self.credentials.iter().map(|cred| {
            let cred_ref = cred["ref"].as_str().unwrap_or("");
            let mut consumed_by: Vec<String> = Vec::new();

            // Check mcp servers
            for server in &self.mcp {
                if server["auth"]["credentialRef"].as_str() == Some(cred_ref) {
                    if let Some(sid) = server["id"].as_str() {
                        consumed_by.push(format!("mcp:{sid}"));
                    }
                }
            }

            // Check channels
            for channel in &self.channels {
                if channel["credentialRef"].as_str() == Some(cred_ref) {
                    if let Some(cid) = channel["id"].as_str() {
                        consumed_by.push(format!("channel:{cid}"));
                    }
                }
            }

            consumed_by.sort();

            json!({
                "ref": cred["ref"],
                "label": cred["label"],
                "type": cred["type"],
                "consumedBy": consumed_by,
                "required": cred["required"],
                "help": cred["help"]
            })
        }).collect();

        // Compute network endpoints (unique hosts from mcp servers with url field, sorted)
        let mut endpoints: Vec<String> = self
            .mcp
            .iter()
            .filter_map(|s| s["url"].as_str().and_then(extract_host))
            .collect();
        endpoints.sort();
        endpoints.dedup();

        // spawnsProcesses: any mcp server has transport == "stdio"
        let spawns_processes = self.mcp.iter().any(|s| s["transport"].as_str() == Some("stdio"));

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

    pub fn set_meta(&mut self, meta: Value) {
        if let Some(name) = meta.get("name").and_then(|v| v.as_str()) {
            self.name = name.to_string();
        }
        if let Some(desc) = meta.get("description").and_then(|v| v.as_str()) {
            self.description = desc.to_string();
        }
        if let Some(ver) = meta.get("version").and_then(|v| v.as_str()) {
            self.version = ver.to_string();
        }
        // Note: displayName is NOT updated by set_meta (matches TS behavior)
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
    fn build_bundle(&self) -> Bundle {
        let state = self.state();
        let manifest_value = &state["manifest"];
        let manifest_json = serde_json::to_string_pretty(manifest_value)
            .expect("manifest serialises");

        let mut bundle = Bundle::default();
        bundle.set("uniqent.json", manifest_json.into_bytes());

        if let Some(readme) = &self.readme {
            if !readme.trim().is_empty() {
                bundle.set("README.md", readme.as_bytes().to_vec());
            }
        }
        if let Some(persona) = &self.persona {
            bundle.set("identity/persona.md", persona.as_bytes().to_vec());
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
                            bundle.set(&format!("avatar.{ext}"), bytes);
                        }
                    }
                }
            }
        }

        // MCP servers
        if !self.mcp.is_empty() {
            let servers_json = serde_json::to_string_pretty(&json!({"servers": self.mcp}))
                .expect("mcp serialises");
            bundle.set("mcp/servers.json", servers_json.into_bytes());
        }

        // Skills
        for (name, md) in &self.skills {
            bundle.set(&format!("skills/{name}/SKILL.md"), md.as_bytes().to_vec());
        }

        // Channels
        if !self.channels.is_empty() {
            let channels_json = serde_json::to_string_pretty(&json!({"channels": self.channels}))
                .expect("channels serialises");
            bundle.set("channels/channels.json", channels_json.into_bytes());
        }

        // Tasks
        for task in &self.tasks {
            let id = task["id"].as_str().unwrap_or("task");
            let task_json = serde_json::to_string_pretty(task).expect("task serialises");
            bundle.set(&format!("tasks/{id}.json"), task_json.into_bytes());
        }

        // Facts (JSONL format — each fact on its own line, trailing newline)
        if !self.facts.is_empty() {
            let mut facts_jsonl = String::new();
            for fact in &self.facts {
                facts_jsonl.push_str(&serde_json::to_string(fact).expect("fact serialises"));
                facts_jsonl.push('\n');
            }
            bundle.set("memory/facts.jsonl", facts_jsonl.into_bytes());
        }

        // Profile
        if let Some(profile) = &self.profile {
            let profile_json = serde_json::to_string_pretty(profile).expect("profile serialises");
            bundle.set("memory/profile.json", profile_json.into_bytes());
        }

        bundle
    }

    /// Export the current brain as a signed or unsigned .uniqent bundle.
    ///
    /// NOTE: validation is Phase 1's subset (see pack_checked); full assertValid parity
    /// with TS pack is deferred to Phase 3.
    pub fn export(&mut self, sign_it: bool) -> Result<Value, String> {
        let state = self.state();
        let validation = state["validation"].clone();
        let name = self.name.clone();

        let bundle = self.build_bundle();

        let (final_bundle, signed) = if sign_it {
            if self.keypair.is_none() {
                self.keypair = Some(generate_keypair());
            }
            let kp = self.keypair.as_ref().unwrap();
            let signed_bundle = sign(&bundle, &kp.private_key)?;
            (signed_bundle, true)
        } else {
            (bundle, false)
        };

        let bytes = pack_checked(&final_bundle)?;
        let verified = if signed { verify(&final_bundle).valid } else { false };
        let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

        Ok(json!({
            "filename": format!("{name}.uniqent"),
            "bytesBase64": bytes_b64,
            "signed": signed,
            "verified": verified,
            "validation": validation,
        }))
    }

    pub fn reset(&mut self) {
        *self = Session::new();
    }
}
