use crate::session::Session;
use serde_json::Value;
use std::sync::Mutex;
use tauri::State;

pub struct AppState(pub Mutex<Session>);

#[tauri::command]
pub fn state(s: State<AppState>) -> Value {
    s.0.lock().unwrap().state()
}

#[tauri::command]
pub fn catalog(s: State<AppState>) -> Value {
    s.0.lock().unwrap().catalog()
}

#[tauri::command]
pub fn set_meta(s: State<AppState>, meta: Value) -> Value {
    let mut g = s.0.lock().unwrap();
    g.set_meta(meta);
    g.state()
}

#[tauri::command]
pub fn set_targets(s: State<AppState>, targets: Vec<String>) -> Value {
    let mut g = s.0.lock().unwrap();
    g.set_targets(targets);
    g.state()
}

#[tauri::command]
pub fn set_persona(s: State<AppState>, persona: String) -> Value {
    let mut g = s.0.lock().unwrap();
    g.set_persona(persona);
    g.state()
}

#[tauri::command]
pub fn set_readme(s: State<AppState>, readme: String) -> Value {
    let mut g = s.0.lock().unwrap();
    g.set_readme(readme);
    g.state()
}

#[tauri::command]
pub fn set_avatar(s: State<AppState>, data_url: String) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.set_avatar(data_url)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_avatar(s: State<AppState>) -> Value {
    let mut g = s.0.lock().unwrap();
    g.remove_avatar();
    g.state()
}

#[tauri::command]
pub fn reset(s: State<AppState>) -> Value {
    let mut g = s.0.lock().unwrap();
    g.reset();
    g.state()
}

#[tauri::command]
pub fn export(s: State<AppState>, sign: bool) -> Result<Value, String> {
    s.0.lock().unwrap().export(sign)
}

// ── MCP commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_mcp_catalog(s: State<AppState>, id: String) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.add_mcp_catalog(&id)?;
    Ok(g.state())
}

#[tauri::command]
pub fn add_custom_mcp(s: State<AppState>, server: Value) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.add_custom_mcp(server)?;
    Ok(g.state())
}

#[tauri::command]
pub fn import_mcp_servers(s: State<AppState>, servers: Value) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.import_mcp_servers(servers)?;
    Ok(g.state())
}

#[tauri::command]
pub fn paste_mcp_preview(s: State<AppState>, text: String) -> Value {
    s.0.lock().unwrap().paste_mcp_preview(&text)
}

#[tauri::command]
pub fn add_pasted_mcp(s: State<AppState>, text: String) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.add_pasted_mcp(&text)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_mcp(s: State<AppState>, id: String) -> Value {
    let mut g = s.0.lock().unwrap();
    g.remove_mcp(&id);
    g.state()
}

// ── Skill commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_skill_catalog(s: State<AppState>, name: String) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.add_skill_catalog(&name)?;
    Ok(g.state())
}

#[tauri::command]
pub fn add_custom_skill(s: State<AppState>, name: String, skill_md: String) -> Value {
    let mut g = s.0.lock().unwrap();
    g.add_custom_skill(&name, &skill_md);
    g.state()
}

#[tauri::command]
pub fn remove_skill(s: State<AppState>, name: String) -> Value {
    let mut g = s.0.lock().unwrap();
    g.remove_skill(&name);
    g.state()
}

// ── Channel commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_channel_catalog(s: State<AppState>, id: String) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.add_channel_catalog(&id)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_channel(s: State<AppState>, id: String) -> Value {
    let mut g = s.0.lock().unwrap();
    g.remove_channel(&id);
    g.state()
}

// ── Task commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_task(s: State<AppState>, payload: Value) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.add_task(payload)?;
    Ok(g.state())
}

#[tauri::command]
pub fn remove_task(s: State<AppState>, id: String) -> Value {
    let mut g = s.0.lock().unwrap();
    g.remove_task(&id);
    g.state()
}

// ── Memory commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn add_memory(s: State<AppState>, text: String, importance: Option<f64>) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    let mut input = serde_json::json!({ "text": text });
    if let Some(imp) = importance {
        input["importance"] = serde_json::json!(imp);
    }
    g.add_fact(input)?;
    Ok(g.state())
}

#[tauri::command]
pub fn import_memory(s: State<AppState>, payload: Value) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap();
    g.import_memory(payload)?;
    Ok(g.state())
}

#[tauri::command]
pub fn preview_memory(s: State<AppState>, text: String) -> Value {
    s.0.lock().unwrap().preview_memory(&text)
}

#[tauri::command]
pub fn memory_graph(s: State<AppState>) -> Value {
    s.0.lock().unwrap().memory_graph()
}

// ── Profile commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_profile(s: State<AppState>) -> Value {
    let g = s.0.lock().unwrap();
    serde_json::json!({ "profile": g.get_profile() })
}

#[tauri::command]
pub fn set_profile(s: State<AppState>, profile: Value) -> Value {
    let mut g = s.0.lock().unwrap();
    g.set_profile(profile);
    g.state()
}
