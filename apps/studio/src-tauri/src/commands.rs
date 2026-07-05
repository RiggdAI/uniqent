use std::sync::Mutex;
use serde_json::Value;
use tauri::State;
use crate::session::Session;

pub struct AppState(pub Mutex<Session>);

#[tauri::command]
pub fn state(s: State<AppState>) -> Value { s.0.lock().unwrap().state() }

#[tauri::command]
pub fn catalog(s: State<AppState>) -> Value { s.0.lock().unwrap().catalog() }

#[tauri::command]
pub fn set_meta(s: State<AppState>, meta: Value) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_meta(meta); g.state()
}

#[tauri::command]
pub fn set_targets(s: State<AppState>, targets: Vec<String>) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_targets(targets); g.state()
}

#[tauri::command]
pub fn set_persona(s: State<AppState>, persona: String) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_persona(persona); g.state()
}

#[tauri::command]
pub fn set_readme(s: State<AppState>, readme: String) -> Value {
    let mut g = s.0.lock().unwrap(); g.set_readme(readme); g.state()
}

#[tauri::command]
pub fn set_avatar(s: State<AppState>, data_url: String) -> Result<Value, String> {
    let mut g = s.0.lock().unwrap(); g.set_avatar(data_url)?; Ok(g.state())
}

#[tauri::command]
pub fn remove_avatar(s: State<AppState>) -> Value {
    let mut g = s.0.lock().unwrap(); g.remove_avatar(); g.state()
}

#[tauri::command]
pub fn reset(s: State<AppState>) -> Value {
    let mut g = s.0.lock().unwrap(); g.reset(); g.state()
}

#[tauri::command]
pub fn export(s: State<AppState>, sign: bool) -> Result<Value, String> {
    s.0.lock().unwrap().export(sign)
}
