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
