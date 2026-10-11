use crate::session::{open_bundle_bytes, BundleFile, Session};
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// Shared app state: the brain draft, the folders the user picked or dropped this session (the
/// only folders Rust will read) and the files dropped on the window (the only files
/// `open_dropped_bundle` opens).
pub struct AppState {
    pub session: Mutex<Session>,
    pub granted_dirs: Mutex<Vec<PathBuf>>,
    pub granted_files: Mutex<Vec<PathBuf>>,
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
    crate::fs_io::allowed_root(root, &s.granted_dirs.lock().unwrap(), &env)
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

/// `{ home, targets: [{ id, root, present, error }], claudeCodeUser }`: `error` (else null) says why
/// a home is unusable (see `fs_io::safe_home`; then `present` is false); `claudeCodeUser`:
/// `~/.claude` exists.
#[tauri::command]
pub fn framework_homes() -> Result<Value, String> {
    let env = crate::fs_io::HomeEnv::from_process()?;
    let targets = crate::fs_io::framework_homes(&env)
        .into_iter()
        .map(|(id, root)| {
            let (present, error) = match crate::fs_io::safe_home(id, &root, &env.home) {
                Ok(_) => (home_present(id, &root)?, None),
                Err(e) => (false, Some(e)),
            };
            Ok(serde_json::json!({
                "id": id,
                "root": root.to_string_lossy(),
                "present": present,
                "error": error,
            }))
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

// ── Bundles: open, save, load ───────────────────────────────────────────────

/// The current draft as an unsigned bundle (what install translates).
#[tauri::command]
pub fn bundle_files(s: State<AppState>) -> Result<Vec<BundleFile>, String> {
    s.session.lock().unwrap().bundle_files()
}

/// Swap `next` in as the session, keeping the hub index URLs; `{ state, dropped }`.
fn replace_session(state: &AppState, next: Session, dropped: Vec<String>) -> Result<Value, String> {
    let mut g = state.session.lock().unwrap();
    let mut next = next;
    next.set_hub_indexes(g.hub_indexes())?;
    *g = next;
    Ok(serde_json::json!({ "state": g.state(), "dropped": dropped }))
}

/// Replace the session with a bundle given as files (a capture); `{ state, dropped }`.
#[tauri::command]
pub fn load_bundle_files(s: State<AppState>, files: Vec<BundleFile>) -> Result<Value, String> {
    load_files_into(&s, files)
}

/// `load_bundle_files` on `state`: the session is swapped only when every file loads.
pub fn load_files_into(state: &AppState, files: Vec<BundleFile>) -> Result<Value, String> {
    let mut map = std::collections::BTreeMap::new();
    for f in files {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&f.bytes_base64)
            .map_err(|_| format!("{}: bytesBase64 is not valid base64", f.path))?;
        if map.insert(f.path.clone(), bytes).is_some() {
            return Err(format!("{} is given twice", f.path));
        }
    }
    let bundle = crate::core::bundle::Bundle::from_files(map)?;
    let (next, dropped) = Session::load_bundle(&bundle)?;
    replace_session(state, next, dropped)
}

/// Read the `.uniqent` at `path` (canonical), verify it and swap it in as the session;
/// `{ state, dropped, signature: "valid" | "unsigned" }`.
fn open_bundle_at(state: &AppState, path: &Path) -> Result<Value, String> {
    let label = path.display().to_string();
    let bytes = crate::vault::read_note(path, &label, crate::core::archive::MAX_UNPACKED_BYTES)?;
    let (bundle, signature) = open_bundle_bytes(&bytes).map_err(|e| format!("{label}: {e}"))?;
    let (next, dropped) = Session::load_bundle(&bundle).map_err(|e| format!("{label}: {e}"))?;
    let mut out = replace_session(state, next, dropped)?;
    out["signature"] = serde_json::json!(signature);
    Ok(out)
}

/// Open a `.uniqent` from the native file dialog (None when cancelled). The picked file is read
/// once and not granted. Async: a blocking dialog on the main thread deadlocks.
#[tauri::command]
pub async fn open_bundle(
    app: tauri::AppHandle,
    s: State<'_, AppState>,
) -> Result<Option<Value>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Uniqent bundle", &["uniqent"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("picked file is not a local path: {e}"))?;
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    open_bundle_at(&s, &canonical).map(Some)
}

/// Open a `.uniqent` dropped on the window: only a file the drop handler granted. Async so the
/// read and unpack run off the main thread.
#[tauri::command]
pub async fn open_dropped_bundle(s: State<'_, AppState>, path: String) -> Result<Value, String> {
    let canonical = crate::vault::granted_file(&s.granted_files.lock().unwrap(), &path)?;
    open_bundle_at(&s, &canonical)
}

/// Save the brain, always signed with the session keypair (like `export(true)`), to a file the
/// user chooses in the native save dialog; written atomically. Returns the path (None when
/// cancelled). Signing runs first, so a secret-scan refusal shows before the dialog.
#[tauri::command]
pub async fn save_bundle(
    app: tauri::AppHandle,
    s: State<'_, AppState>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (file_name, bytes) = {
        let mut g = s.session.lock().unwrap();
        (g.file_name(), g.signed_bytes()?)
    };
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter("Uniqent bundle", &["uniqent"])
        .set_file_name(&file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| format!("chosen file is not a local path: {e}"))?;
    let (Some(parent), Some(name)) = (path.parent(), path.file_name().and_then(|n| n.to_str()))
    else {
        return Err(format!(
            "cannot save to {}: not a file path",
            path.display()
        ));
    };
    let dir = parent
        .canonicalize()
        .map_err(|e| format!("cannot save to {}: {e}", parent.display()))?;
    let write = crate::fs_io::OutputWrite {
        path: name.to_string(),
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        mode: None,
    };
    crate::fs_io::write_outputs(&dir, &[write])?;
    Ok(Some(dir.join(name).to_string_lossy().into_owned()))
}

// ── Drag and drop ───────────────────────────────────────────────────────────

/// One path dropped on the window and granted by Rust (the `studio://dropped` payload).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DroppedPath {
    pub path: String,
    pub kind: &'static str, // "dir" | "file"
}

/// Grant dropped paths, canonicalized: folders join `granted_dirs`, regular files
/// `granted_files`. Returns what was granted (`studio://dropped`) plus why each other path was
/// refused (`studio://drop-refused`; names paths, never content).
pub fn grant_dropped(state: &AppState, paths: &[PathBuf]) -> (Vec<DroppedPath>, Vec<String>) {
    let mut granted = vec![];
    let mut refused = vec![];
    for path in paths {
        let canonical = match path.canonicalize() {
            Ok(c) => c,
            Err(e) => {
                refused.push(format!("cannot open {}: {e}", path.display()));
                continue;
            }
        };
        let (kind, list) = if canonical.is_dir() {
            ("dir", &state.granted_dirs)
        } else if canonical.is_file() {
            ("file", &state.granted_files)
        } else {
            refused.push(format!(
                "{} is neither a folder nor a regular file",
                canonical.display()
            ));
            continue;
        };
        list.lock().unwrap().push(canonical.clone());
        granted.push(DroppedPath {
            path: canonical.to_string_lossy().into_owned(),
            kind,
        });
    }
    (granted, refused)
}
