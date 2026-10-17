//! Build a session from a bundle: every component checked with the setters' rules, everything the
//! session cannot hold reported in `dropped`.
use base64::Engine;
use serde_json::{json, Map, Value};

use super::{
    cron_problem, is_valid_slug, json_type, profile_field_kept, validate_credential,
    validate_importance, validate_visibility, Session, MEMORY_KINDS, POLICIES,
};
use crate::core::bundle::{paths, Bundle};

// Bundle paths (TS core `PATHS`).
const README: &str = "README.md";
const PERSONA: &str = "identity/persona.md";
const PROFILE: &str = "memory/profile.json";
const FACTS: &str = "memory/facts.jsonl";
const EPISODIC: &str = "memory/episodic.jsonl";
const MCP: &str = "mcp/servers.json";
const CHANNELS: &str = "channels/channels.json";
const TOOLS: &str = "tools/tools.json";
const RUNTIME: &str = "setup/runtime.json";

const MCP_TRANSPORTS: [&str; 3] = ["streamable-http", "sse", "stdio"];
const MCP_AUTH_TYPES: [&str; 4] = ["none", "bearer", "header", "oauth2"];
const CHANNEL_KINDS: [&str; 7] = [
    "telegram", "discord", "slack", "whatsapp", "sms", "email", "webhook",
];

/// `path` as UTF-8 text, or `None` when the bundle has no such file.
fn bundle_text(bundle: &Bundle, path: &str) -> Result<Option<String>, String> {
    bundle
        .get(path)
        .map(|b| {
            String::from_utf8(b.clone()).map_err(|_| format!("{path} is not valid UTF-8 text"))
        })
        .transpose()
}

/// `path` parsed as JSON, or `None` when the bundle has no such file.
fn bundle_json(bundle: &Bundle, path: &str) -> Result<Option<Value>, String> {
    bundle_text(bundle, path)?
        .map(|t| serde_json::from_str(&t).map_err(|e| format!("{path} is not valid JSON: {e}")))
        .transpose()
}

fn is_string_array(v: &Value) -> bool {
    v.as_array().is_some_and(|a| a.iter().all(Value::is_string))
}

fn is_non_empty_string(v: &Value) -> bool {
    v.as_str().is_some_and(|s| !s.is_empty())
}

/// An id or enum value for an error: the string itself, else only its JSON type.
fn shown(v: &Value) -> String {
    match v {
        Value::String(s) => format!("\"{s}\""),
        other => json_type(other).to_string(),
    }
}

/// An optional field's name and the check its value must pass when present.
type FieldCheck = (&'static str, fn(&Value) -> bool);

/// The first optional field of `obj` among `fields` that is present but fails its check.
fn bad_optional(obj: &Value, fields: &[FieldCheck]) -> Option<String> {
    fields
        .iter()
        .find(|(key, ok)| obj.get(*key).is_some_and(|v| !ok(v)))
        .map(|(key, _)| format!("{key} has the wrong type ({})", json_type(&obj[*key])))
}

/// Why `s` is not a spec McpServer, or `None`. Shared by loading and `add_custom_mcp`.
pub(super) fn mcp_server_problem(s: &Value) -> Option<String> {
    if !is_non_empty_string(&s["id"]) {
        return Some(format!(
            "id must be a non-empty string, got {}",
            shown(&s["id"])
        ));
    }
    let Some(transport) = s["transport"]
        .as_str()
        .filter(|t| MCP_TRANSPORTS.contains(t))
    else {
        return Some(format!(
            "transport must be one of {}, got {}",
            MCP_TRANSPORTS.join("|"),
            shown(&s["transport"])
        ));
    };
    let optional: [FieldCheck; 5] = [
        ("url", Value::is_string),
        ("command", Value::is_string),
        ("description", Value::is_string),
        ("args", is_string_array),
        ("env", |v| {
            v.as_object()
                .is_some_and(|m| m.values().all(Value::is_string))
        }),
    ];
    if let Some(problem) = bad_optional(s, &optional) {
        return Some(problem);
    }
    if transport != "stdio" && !is_non_empty_string(&s["url"]) {
        return Some(format!("transport \"{transport}\" requires a url"));
    }
    if transport == "stdio" && !is_non_empty_string(&s["command"]) {
        return Some("transport \"stdio\" requires a command".into());
    }
    let auth = &s["auth"];
    let Some(auth_type) = auth["type"].as_str().filter(|t| MCP_AUTH_TYPES.contains(t)) else {
        return Some(format!(
            "auth.type must be one of {}, got {}",
            MCP_AUTH_TYPES.join("|"),
            shown(&auth["type"])
        ));
    };
    let auth_fields: [FieldCheck; 2] = [
        ("credentialRef", Value::is_string),
        ("headerName", Value::is_string),
    ];
    if let Some(problem) = bad_optional(auth, &auth_fields) {
        return Some(format!("auth.{problem}"));
    }
    if auth_type == "header" && !is_non_empty_string(&auth["headerName"]) {
        return Some("auth type \"header\" requires headerName".into());
    }
    let include = &s["tools"]["include"];
    if include != "all" && !is_string_array(include) {
        return Some(format!(
            "tools.include must be \"all\" or an array of tool names, got {}",
            json_type(include)
        ));
    }
    None
}

/// Why `c` is not a channel the session holds (spec Channel with a slug id), or `None`.
fn channel_problem(c: &Value) -> Option<String> {
    if !c["id"].as_str().is_some_and(is_valid_slug) {
        return Some(format!("id must be slug-safe, got {}", shown(&c["id"])));
    }
    if !c["kind"]
        .as_str()
        .is_some_and(|k| CHANNEL_KINDS.contains(&k))
    {
        return Some(format!(
            "kind must be one of {}, got {}",
            CHANNEL_KINDS.join("|"),
            shown(&c["kind"])
        ));
    }
    bad_optional(
        c,
        &[
            ("credentialRef", Value::is_string),
            ("description", Value::is_string),
            ("config", Value::is_object),
        ],
    )
}

/// Why `t` is not a task the session holds (spec Task with a slug id; a schedule's cron must
/// parse like `add_task`'s), or `None`.
fn task_problem(t: &Value) -> Option<String> {
    if !t["id"].as_str().is_some_and(is_valid_slug) {
        return Some(format!("id must be slug-safe, got {}", shown(&t["id"])));
    }
    if !is_non_empty_string(&t["name"]) {
        return Some(format!(
            "name must be a non-empty string, got {}",
            json_type(&t["name"])
        ));
    }
    let trigger = &t["trigger"];
    match trigger["type"].as_str() {
        Some("schedule") => {
            let cron = trigger["cron"].as_str().unwrap_or("");
            let problem = if cron.is_empty() {
                Some("a cron expression is required".to_string())
            } else {
                cron_problem(cron)
            };
            if let Some(p) = problem {
                return Some(format!("trigger.cron \"{cron}\" is invalid: {p}"));
            }
        }
        Some("event") if is_non_empty_string(&trigger["event"]) => {}
        Some("event") => return Some("an event trigger needs an event name".into()),
        Some("manual") => {}
        _ => {
            return Some(format!(
                "trigger.type must be schedule, event or manual, got {}",
                shown(&trigger["type"])
            ))
        }
    }
    if !is_non_empty_string(&t["action"]["kind"]) {
        return Some(format!(
            "action.kind must be a non-empty string, got {}",
            shown(&t["action"]["kind"])
        ));
    }
    let action_fields: [FieldCheck; 2] =
        [("prompt", Value::is_string), ("params", Value::is_object)];
    if let Some(problem) = bad_optional(&t["action"], &action_fields) {
        return Some(format!("action.{problem}"));
    }
    if !t["enabled"].is_boolean() {
        return Some(format!(
            "enabled must be a boolean, got {}",
            json_type(&t["enabled"])
        ));
    }
    bad_optional(t, &[("description", Value::is_string)])
}

/// Why `m` is not a spec MemoryItem (the `import_memory` item checks, plus the bundle's required
/// id and createdAt), or `None`.
fn memory_item_problem(m: &Value) -> Option<String> {
    if !is_non_empty_string(&m["id"]) {
        return Some(format!(
            "id must be a non-empty string, got {}",
            shown(&m["id"])
        ));
    }
    if !m["kind"]
        .as_str()
        .is_some_and(|k| MEMORY_KINDS.contains(&k))
    {
        return Some(format!(
            "kind must be one of {}, got {}",
            MEMORY_KINDS.join(", "),
            shown(&m["kind"])
        ));
    }
    if !m["text"].is_string() {
        return Some(format!(
            "text must be a string, got {}",
            json_type(&m["text"])
        ));
    }
    if !is_non_empty_string(&m["createdAt"]) {
        return Some(format!(
            "createdAt must be an ISO timestamp, got {}",
            shown(&m["createdAt"])
        ));
    }
    if let Err(e) = validate_importance(m.get("importance"), "importance")
        .and(validate_visibility(m.get("visibility"), "visibility"))
    {
        return Some(e);
    }
    bad_optional(
        m,
        &[("source", Value::is_string), ("tags", is_string_array)],
    )
}

/// The `key` array of JSON file `path` (none when absent), every item checked by `problem`.
fn items_of(
    bundle: &Bundle,
    path: &str,
    key: &str,
    problem: fn(&Value) -> Option<String>,
) -> Result<Vec<Value>, String> {
    let Some(file) = bundle_json(bundle, path)? else {
        return Ok(vec![]);
    };
    let items = file[key]
        .as_array()
        .ok_or_else(|| format!("{path}: \"{key}\" must be an array"))?;
    for (i, item) in items.iter().enumerate() {
        if let Some(p) = problem(item) {
            return Err(format!("{path}: {key}[{i}]: {p}"));
        }
    }
    Ok(items.clone())
}

/// Every `tasks/*.json` file (in path order), each checked by `task_problem`.
fn task_files(bundle: &Bundle) -> Result<Vec<Value>, String> {
    let mut tasks = vec![];
    for (path, _) in bundle.entries().filter(|(p, _)| is_task_path(p)) {
        let task = bundle_json(bundle, path)?.expect("listed task file");
        if let Some(p) = task_problem(&task) {
            return Err(format!("{path}: {p}"));
        }
        tasks.push(task);
    }
    Ok(tasks)
}

fn is_task_path(path: &str) -> bool {
    path.starts_with("tasks/") && path.ends_with(".json")
}

/// The memory items of JSONL file `path` (blank lines skipped), each checked; errors name the line.
fn memory_lines(bundle: &Bundle, path: &str) -> Result<Vec<Value>, String> {
    let Some(text) = bundle_text(bundle, path)? else {
        return Ok(vec![]);
    };
    let mut items = vec![];
    for (i, line) in text.split('\n').enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let item: Value = serde_json::from_str(line.trim())
            .map_err(|e| format!("{path}:{} is not valid JSON: {e}", i + 1))?;
        if let Some(p) = memory_item_problem(&item) {
            return Err(format!("{path}:{}: {p}", i + 1));
        }
        items.push(item);
    }
    Ok(items)
}

/// Fails, naming `label`, when two items share an id.
fn unique_ids(items: &[Value], label: &str) -> Result<(), String> {
    let mut seen: Vec<&str> = vec![];
    for id in items.iter().filter_map(|v| v["id"].as_str()) {
        if seen.contains(&id) {
            return Err(format!("{label}: id \"{id}\" is used twice"));
        }
        seen.push(id);
    }
    Ok(())
}

/// The highest N among ids `<prefix>N` (0 when none), so generated ids continue past it.
fn highest_suffix(items: &[Value], prefix: &str) -> u32 {
    items
        .iter()
        .filter_map(|v| v["id"].as_str()?.strip_prefix(prefix)?.parse().ok())
        .max()
        .unwrap_or(0)
}

/// The bundle's avatar file (TS `Bundle.avatar`) and its mime type when the session can hold it
/// (png, jpeg, webp; `None` for gif or svg).
fn avatar_path(bundle: &Bundle) -> Option<(String, Option<&'static str>)> {
    bundle.entries().find_map(|(path, _)| {
        let mime = match path.to_lowercase().strip_prefix("avatar.")? {
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "webp" => Some("image/webp"),
            "gif" | "svg" => None,
            _ => return None,
        };
        Some((path.clone(), mime))
    })
}

/// `(name, path)` of every `skills/<name>/SKILL.md`.
fn skill_paths(bundle: &Bundle) -> Vec<(String, String)> {
    bundle
        .entries()
        .filter_map(|(path, _)| {
            let name = path.strip_prefix("skills/")?.strip_suffix("/SKILL.md")?;
            (!name.contains('/')).then(|| (name.to_string(), path.clone()))
        })
        .collect()
}

/// Each credential ref declared more than once (in first-seen order): `add_credential` keeps only
/// the last declaration.
fn duplicate_refs(credentials: &[Value]) -> Vec<String> {
    let refs: Vec<&str> = credentials
        .iter()
        .filter_map(|c| c["ref"].as_str())
        .collect();
    let mut repeated: Vec<String> = vec![];
    for (i, r) in refs.iter().enumerate() {
        if refs[..i].contains(r) && !repeated.iter().any(|x| x == r) {
            repeated.push(r.to_string());
        }
    }
    repeated
}

/// `profile` without its non-text fields, plus their quoted names and JSON types (a spec profile
/// may hold any JSON value; Studio keeps text only). A non-object stays as is: `set_profile`
/// refuses it.
fn text_profile(profile: &Value) -> (Value, Vec<String>) {
    let Value::Object(map) = profile else {
        return (profile.clone(), vec![]);
    };
    let (text, other): (Map<String, Value>, Map<String, Value>) =
        map.clone().into_iter().partition(|(_, v)| v.is_string());
    let named = other
        .iter()
        .map(|(k, v)| format!("\"{k}\" ({})", json_type(v)))
        .collect();
    (Value::Object(text), named)
}

/// The quoted names of a profile's blank fields (`set_profile` drops them).
fn empty_fields(profile: &Value) -> Vec<String> {
    profile
        .as_object()
        .map(|m| {
            m.iter()
                .filter(|(k, v)| !profile_field_kept(k, v.as_str().unwrap_or("")))
                .map(|(k, _)| format!("\"{k}\""))
                .collect()
        })
        .unwrap_or_default()
}

/// Manifest fields the session does not hold: author, license and tags (Studio exports fixed
/// values), suggested prompts, and declared permissions beyond what the content derives.
fn manifest_drops(manifest: &Value, derived_permissions: &Value) -> Vec<String> {
    let fixed = [
        ("author", json!({ "name": "Anonymous" })),
        ("license", json!("CC0-1.0")),
        ("tags", json!([])),
    ];
    let mut dropped: Vec<String> = fixed
        .iter()
        .filter(|(key, value)| &manifest[*key] != value)
        .map(|(key, value)| {
            format!(
                "uniqent.json {key} {} is replaced by {value}: Studio exports a fixed {key}",
                manifest[*key]
            )
        })
        .collect();
    if let Some(prompts) = manifest.get("suggestedPrompts") {
        dropped.push(format!(
            "uniqent.json suggestedPrompts {prompts} left out: Studio does not hold them"
        ));
    }
    if &manifest["permissions"] != derived_permissions {
        dropped.push(format!(
            "uniqent.json permissions {} are replaced by {derived_permissions}: Studio derives permissions from the brain's content",
            manifest["permissions"]
        ));
    }
    dropped
}

/// A line for every bundle file the session does not hold (`avatar` is the one it holds).
fn dropped_files(bundle: &Bundle, avatar: Option<String>) -> Result<Vec<String>, String> {
    let skills = skill_paths(bundle);
    let held = |p: &str| {
        [
            paths::MANIFEST,
            README,
            PERSONA,
            POLICIES,
            PROFILE,
            FACTS,
            MCP,
            CHANNELS,
        ]
        .contains(&p)
            || avatar.as_deref() == Some(p)
            || is_task_path(p)
            || skills.iter().any(|(_, sp)| sp == p)
    };
    let mut dropped = vec![];
    for (path, _) in bundle.entries().filter(|(p, _)| !held(p)) {
        dropped.push(match path.as_str() {
            paths::SIGNATURE => {
                "signature.json: the signature does not carry over — re-sign on export".into()
            }
            EPISODIC => format!(
                "{EPISODIC}: {} episodic item(s) left out — Studio does not hold episodic memory",
                memory_lines(bundle, EPISODIC)?.len()
            ),
            TOOLS => format!("{TOOLS}: tool declarations left out — Studio does not hold tools"),
            RUNTIME => format!(
                "{RUNTIME}: runtime config (model, autonomy, tool allowlist, defaults) left out — Studio does not hold it"
            ),
            p if p.starts_with("skills/") => {
                format!("{p}: left out — Studio keeps only each skill's SKILL.md")
            }
            p if avatar_path(bundle).is_some_and(|(a, _)| a == p) => {
                format!("{p}: left out — Studio holds png, jpeg or webp avatars only")
            }
            p => format!("{p}: left out — Studio has no place for this file"),
        });
    }
    Ok(dropped)
}

impl Session {
    /// A new session holding `bundle`, plus a line for everything the session cannot hold (see
    /// `dropped_files` and `manifest_drops`). Every component is checked with the setters' rules
    /// first; an error names the bundle file and field.
    pub fn load_bundle(bundle: &Bundle) -> Result<(Session, Vec<String>), String> {
        let manifest =
            bundle_json(bundle, paths::MANIFEST)?.ok_or("uniqent.json is missing: not a bundle")?;
        if manifest["specVersion"] != "0.1" {
            return Err(format!(
                "uniqent.json: specVersion must be \"0.1\", got {}",
                shown(&manifest["specVersion"])
            ));
        }
        let mut s = Session::new();
        let meta: Map<String, Value> = ["name", "displayName", "version", "description"]
            .iter()
            .map(|k| (k.to_string(), manifest[*k].clone()))
            .collect();
        s.set_meta(Value::Object(meta))
            .map_err(|e| format!("uniqent.json: {e}"))?;
        let targets = &manifest["compatibility"]["targets"];
        let target_ids: Option<Vec<String>> = targets
            .as_array()
            .and_then(|a| a.iter().map(|t| t.as_str().map(String::from)).collect());
        s.set_targets(target_ids.ok_or_else(|| {
            format!(
                "uniqent.json: compatibility.targets must be an array of strings, got {}",
                json_type(targets)
            )
        })?);
        let credentials = manifest["credentials"]
            .as_array()
            .ok_or("uniqent.json: credentials must be an array")?;
        for (i, c) in credentials.iter().enumerate() {
            validate_credential(c).map_err(|e| format!("uniqent.json: credentials[{i}]: {e}"))?;
        }

        if let Some(persona) = bundle_text(bundle, PERSONA)? {
            s.set_persona(persona);
        }
        s.policies = bundle_text(bundle, POLICIES)?;
        if let Some(readme) = bundle_text(bundle, README)? {
            s.set_readme(readme);
        }
        let avatar = avatar_path(bundle).and_then(|(path, mime)| Some((path, mime?)));
        if let Some((path, mime)) = &avatar {
            let b64 = base64::engine::general_purpose::STANDARD.encode(bundle.get(path).unwrap());
            s.set_avatar(format!("data:{mime};base64,{b64}"))
                .map_err(|e| format!("{path}: {e}"))?;
        }

        let servers = items_of(bundle, MCP, "servers", mcp_server_problem)?;
        unique_ids(&servers, MCP)?;
        for server in servers {
            s.add_custom_mcp(server)?;
        }
        for c in credentials {
            s.add_credential(c.clone());
        }
        for (name, path) in skill_paths(bundle) {
            let md = bundle_text(bundle, &path)?.expect("listed skill file");
            s.add_custom_skill(&name, &md)
                .map_err(|e| format!("{path}: {e}"))?;
        }
        s.channels = items_of(bundle, CHANNELS, "channels", channel_problem)?;
        unique_ids(&s.channels, CHANNELS)?;
        s.tasks = task_files(bundle)?;
        unique_ids(&s.tasks, "tasks/")?;
        s.task_counter = highest_suffix(&s.tasks, "task-");
        let (episodic, facts): (Vec<Value>, Vec<Value>) = memory_lines(bundle, FACTS)?
            .into_iter()
            .partition(|f| f["kind"] == "episodic");
        unique_ids(&facts, FACTS)?;
        s.fact_counter = highest_suffix(&facts, "fact-");
        s.facts = facts;
        let (profile, non_text) = bundle_json(bundle, PROFILE)?
            .map(|p| text_profile(&p))
            .map_or((None, vec![]), |(text, other)| (Some(text), other));
        if let Some(p) = &profile {
            s.set_profile(p.clone())
                .map_err(|e| format!("{PROFILE}: {e}"))?;
        }

        let mut dropped = manifest_drops(&manifest, &s.state()["manifest"]["permissions"]);
        dropped.extend(duplicate_refs(credentials).into_iter().map(|r| {
            format!("uniqent.json credentials: ref \"{r}\" is declared more than once; Studio keeps the last declaration")
        }));
        if bundle.has(README) && s.readme.is_none() {
            dropped.push(format!(
                "{README}: left out — it is blank, and Studio keeps no blank README"
            ));
        }
        let empty = profile.as_ref().map(empty_fields).unwrap_or_default();
        if !empty.is_empty() {
            dropped.push(format!(
                "{PROFILE}: blank field(s) {} left out — Studio keeps no blank profile names or values",
                empty.join(", ")
            ));
        }
        if !non_text.is_empty() {
            dropped.push(format!(
                "{PROFILE}: non-text field(s) {} left out — Studio keeps only text profile fields",
                non_text.join(", ")
            ));
        }
        if !episodic.is_empty() {
            dropped.push(format!(
                "{FACTS}: {} episodic item(s) left out — Studio does not hold episodic memory",
                episodic.len()
            ));
        }
        dropped.extend(dropped_files(bundle, avatar.map(|(p, _)| p))?);
        Ok((s, dropped))
    }
}
