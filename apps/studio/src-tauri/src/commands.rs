use crate::session::Session;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// Shared app state: the brain draft, and the folders the user picked this session (the only
/// folders Rust will read).
pub struct AppState {
    pub session: Mutex<Session>,
    pub granted_dirs: Mutex<Vec<PathBuf>>,
}

#[tauri::command]
pub fn state(s: State<AppState>) -> Value {
    s.session.lock().unwrap().state()
}

#[tauri::command]
pub fn catalog(s: State<AppState>) -> Value {
    s.session.lock().unwrap().catalog()
}

#[tauri::command]
pub fn set_meta(s: State<AppState>, meta: Value) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.set_meta(meta)?;
    Ok(g.state())
}

#[tauri::command]
pub fn set_targets(s: State<AppState>, targets: Vec<String>) -> Value {
    let mut g = s.session.lock().unwrap();
    g.set_targets(targets);
    g.state()
}

#[tauri::command]
pub fn set_persona(s: State<AppState>, persona: String) -> Value {
    let mut g = s.session.lock().unwrap();
    g.set_persona(persona);
    g.state()
}

#[tauri::command]
pub fn set_readme(s: State<AppState>, readme: String) -> Value {
    let mut g = s.session.lock().unwrap();
    g.set_readme(readme);
    g.state()
}

#[tauri::command]
pub fn set_avatar(s: State<AppState>, data_url: String) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.set_avatar(data_url)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_avatar(s: State<AppState>) -> Value {
    let mut g = s.session.lock().unwrap();
    g.remove_avatar();
    g.state()
}

#[tauri::command]
pub fn reset(s: State<AppState>) -> Value {
    let mut g = s.session.lock().unwrap();
    g.reset();
    g.state()
}

#[tauri::command]
pub fn export(s: State<AppState>, sign: bool) -> Result<Value, String> {
    s.session.lock().unwrap().export(sign)
}

// ── MCP commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_mcp_catalog(s: State<AppState>, id: String) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_mcp_catalog(&id)?;
    Ok(g.state())
}

#[tauri::command]
pub fn add_custom_mcp(s: State<AppState>, server: Value) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_custom_mcp(server)?;
    Ok(g.state())
}

#[tauri::command]
pub fn import_mcp_servers(s: State<AppState>, servers: Value) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.import_mcp_servers(servers)?;
    Ok(g.state())
}

#[tauri::command]
pub fn paste_mcp_preview(s: State<AppState>, text: String) -> Value {
    s.session.lock().unwrap().paste_mcp_preview(&text)
}

#[tauri::command]
pub fn add_pasted_mcp(s: State<AppState>, text: String) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_pasted_mcp(&text)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_mcp(s: State<AppState>, id: String) -> Value {
    let mut g = s.session.lock().unwrap();
    g.remove_mcp(&id);
    g.state()
}

// ── Skill commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_skill_catalog(s: State<AppState>, name: String) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_skill_catalog(&name)?;
    Ok(g.state())
}

#[tauri::command]
pub fn add_custom_skill(
    s: State<AppState>,
    name: String,
    skill_md: String,
) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_custom_skill(&name, &skill_md)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_skill(s: State<AppState>, name: String) -> Value {
    let mut g = s.session.lock().unwrap();
    g.remove_skill(&name);
    g.state()
}

// ── Channel commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_channel_catalog(s: State<AppState>, id: String) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_channel_catalog(&id)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_channel(s: State<AppState>, id: String) -> Value {
    let mut g = s.session.lock().unwrap();
    g.remove_channel(&id);
    g.state()
}

// ── Task commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_task(s: State<AppState>, payload: Value) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_task(payload)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_task(s: State<AppState>, id: String) -> Value {
    let mut g = s.session.lock().unwrap();
    g.remove_task(&id);
    g.state()
}

// ── Memory commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_memory(
    s: State<AppState>,
    text: String,
    importance: Option<f64>,
) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    let mut input = serde_json::json!({ "text": text });
    if let Some(imp) = importance {
        input["importance"] = serde_json::json!(imp);
    }
    g.add_fact(input)?;
    Ok(g.state())
}

#[tauri::command]
pub fn import_memory(s: State<AppState>, payload: Value) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.import_memory(payload)?;
    Ok(g.state())
}

#[tauri::command]
pub fn preview_memory(s: State<AppState>, text: String) -> Value {
    s.session.lock().unwrap().preview_memory(&text)
}

#[tauri::command]
pub fn memory_graph(s: State<AppState>) -> Value {
    s.session.lock().unwrap().memory_graph()
}

// ── Profile commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_profile(s: State<AppState>) -> Value {
    let g = s.session.lock().unwrap();
    serde_json::json!({ "profile": g.get_profile() })
}

#[tauri::command]
pub fn set_profile(s: State<AppState>, profile: Value) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.set_profile(profile)?;
    Ok(g.state())
}

// ── Hubs, memory provenance, publish ────────────────────────────────────────

#[tauri::command]
pub fn add_mcp_hub_result(
    s: State<AppState>,
    server: Value,
    credentials: Vec<Value>,
) -> Result<Value, String> {
    let mut g = s.session.lock().unwrap();
    g.add_mcp_hub_result(server, credentials)?;
    Ok(g.state())
}

#[tauri::command]
pub fn hub_indexes(s: State<AppState>) -> Vec<String> {
    s.session.lock().unwrap().hub_indexes()
}

#[tauri::command]
pub fn set_hub_indexes(s: State<AppState>, urls: Vec<String>) -> Result<Vec<String>, String> {
    s.session.lock().unwrap().set_hub_indexes(urls)
}

#[tauri::command]
pub fn publish_payload(s: State<AppState>) -> Result<Value, String> {
    s.session.lock().unwrap().publish_payload()
}

#[tauri::command]
pub fn registry_token(registry: String) -> Result<Option<String>, String> {
    crate::credentials::registry_token(&registry)
}

// ── Folders ─────────────────────────────────────────────────────────────────

/// Open the native folder picker; the chosen folder is granted for reading this session.
#[tauri::command]
pub async fn pick_folder(
    app: tauri::AppHandle,
    s: State<'_, AppState>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("picked folder is not a local path: {e}"))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    s.granted_dirs.lock().unwrap().push(canonical.clone());
    Ok(Some(canonical.to_string_lossy().into_owned()))
}

/// Read a picked vault folder's markdown notes (see vault::walk_vault for the limits). Async so
/// the walk runs off the main thread and a large vault doesn't freeze the UI.
#[tauri::command]
pub async fn read_vault(
    s: State<'_, AppState>,
    dir: String,
) -> Result<Vec<crate::vault::VaultFile>, String> {
    let root = crate::vault::granted_dir(&s.granted_dirs.lock().unwrap(), &dir)?;
    crate::vault::walk_vault(&root, &crate::vault::DEFAULT_LIMITS)
}

// ── Install / capture I/O ───────────────────────────────────────────────────

/// `root` canonicalized, if it is a folder picked this session or a framework home (or under one).
fn allowed(s: &State<AppState>, root: &str) -> Result<PathBuf, String> {
    let env = crate::fs_io::HomeEnv::from_process()?;
    let homes: Vec<PathBuf> = crate::fs_io::framework_homes(&env)
        .into_iter()
        .map(|(_, p)| p)
        .collect();
    crate::fs_io::allowed_root(root, &s.granted_dirs.lock().unwrap(), &homes)
}

/// Async so a large read/write runs off the main thread (same reason as `read_vault`).
#[tauri::command]
pub async fn read_inputs(
    s: State<'_, AppState>,
    root: String,
    files: Vec<String>,
    finds: Vec<crate::fs_io::FindRequest>,
) -> Result<Vec<crate::fs_io::ReadFile>, String> {
    let root = allowed(&s, &root)?;
    crate::fs_io::read_inputs(&root, &files, &finds, &crate::fs_io::DEFAULT_IO_LIMITS)
}

#[tauri::command]
pub async fn write_outputs(
    s: State<'_, AppState>,
    root: String,
    writes: Vec<crate::fs_io::OutputWrite>,
) -> Result<Vec<String>, String> {
    let root = allowed(&s, &root)?;
    crate::fs_io::write_outputs(&root, &writes)
}

/// Hermes is present when its home is a dir; OpenClaw when its state dir holds `openclaw.json`.
fn home_present(id: &str, root: &std::path::Path) -> Result<bool, String> {
    let stat = |p: &std::path::Path| match std::fs::metadata(p) {
        Ok(m) => Ok(Some(m)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot stat {}: {e}", p.display())),
    };
    match id {
        "hermes" => Ok(stat(root)?.is_some_and(|m| m.is_dir())),
        "openclaw" => Ok(stat(&root.join("openclaw.json"))?.is_some()),
        other => Err(format!("no presence rule for framework \"{other}\"")),
    }
}

/// `{ home, targets: [{ id, root, present }], claudeCodeUser }` (`claudeCodeUser`: `~/.claude` exists).
#[tauri::command]
pub fn framework_homes() -> Result<Value, String> {
    let env = crate::fs_io::HomeEnv::from_process()?;
    let targets = crate::fs_io::framework_homes(&env)
        .into_iter()
        .map(|(id, root)| {
            let present = home_present(id, &root)?;
            Ok(serde_json::json!({ "id": id, "root": root.to_string_lossy(), "present": present }))
        })
        .collect::<Result<Vec<Value>, String>>()?;
    let claude = env.home.join(".claude");
    let claude_code_user = claude
        .try_exists()
        .map_err(|e| format!("cannot stat {}: {e}", claude.display()))?;
    Ok(serde_json::json!({
        "home": env.home.to_string_lossy(),
        "targets": targets,
        "claudeCodeUser": claude_code_user,
    }))
}

/// Which of `names` (single file/folder names) exist in a folder picked this session.
#[tauri::command]
pub fn folder_markers(
    s: State<AppState>,
    dir: String,
    names: Vec<String>,
) -> Result<Vec<String>, String> {
    let dir = crate::vault::granted_dir(&s.granted_dirs.lock().unwrap(), &dir)?;
    crate::fs_io::folder_markers(&dir, &names)
}
