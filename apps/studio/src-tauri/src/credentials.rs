//! Reads publish tokens from the CLI's store (`$UNIQENT_CONFIG_DIR` or `~/.uniqent`)/credentials.json,
//! so `uniqent login` also signs Studio in. Shape: { "<registry base>": { "token": "…" } }.
use serde_json::Value;
use std::path::PathBuf;

fn store_path() -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("UNIQENT_CONFIG_DIR") {
        return Ok(PathBuf::from(dir).join("credentials.json"));
    }
    let home = std::env::var("HOME")
        .map_err(|_| "HOME is not set; cannot find ~/.uniqent/credentials.json".to_string())?;
    Ok(PathBuf::from(home)
        .join(".uniqent")
        .join("credentials.json"))
}

/// The token stored for `registry` in the given store JSON (trailing slashes ignored).
pub fn token_from_store(json: &str, registry: &str) -> Result<Option<String>, String> {
    let store: Value = serde_json::from_str(json).map_err(|e| {
        format!("credentials.json is not valid JSON ({e}); run `uniqent login` again")
    })?;
    let key = registry.trim_end_matches('/');
    Ok(store
        .get(key)
        .and_then(|v| v.get("token"))
        .and_then(Value::as_str)
        .map(String::from))
}

/// The stored token for `registry`, or None when the user has not logged in.
pub fn registry_token(registry: &str) -> Result<Option<String>, String> {
    let path = store_path()?;
    match std::fs::read_to_string(&path) {
        Ok(json) => token_from_store(&json, registry),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read {}: {e}", path.display())),
    }
}
