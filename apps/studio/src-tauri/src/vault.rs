//! Walk a user-picked vault folder for markdown notes. Never follows symlinks, skips
//! dot/tooling directories, and fails loudly past the size limits (no silent truncation).
use serde::Serialize;
use std::path::{Path, PathBuf};

/// One markdown note: POSIX path relative to the vault root, and its UTF-8 text.
#[derive(Debug, Serialize)]
pub struct VaultFile {
    pub path: String,
    pub content: String,
}

pub struct VaultLimits {
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
}

/// 5000 notes, 1 MiB per note, 64 MiB in total.
pub const DEFAULT_LIMITS: VaultLimits = VaultLimits {
    max_files: 5000,
    max_file_bytes: 1 << 20,
    max_total_bytes: 64 << 20,
};

const SKIP: [&str; 4] = [".git", ".obsidian", "node_modules", ".trash"];

pub fn walk_vault(root: &Path, limits: &VaultLimits) -> Result<Vec<VaultFile>, String> {
    let mut out = Vec::new();
    let mut total: u64 = 0;
    walk(root, root, limits, &mut out, &mut total)?;
    Ok(out)
}

fn walk(
    root: &Path,
    dir: &Path,
    limits: &VaultLimits,
    out: &mut Vec<VaultFile>,
    total: &mut u64,
) -> Result<(), String> {
    let entries =
        std::fs::read_dir(dir).map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || SKIP.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        // file_type() does not follow symlinks: a symlink is neither dir nor file here → skipped.
        let file_type = entry
            .file_type()
            .map_err(|e| format!("cannot stat {}: {e}", path.display()))?;
        if file_type.is_dir() {
            walk(root, &path, limits, out, total)?;
        } else if file_type.is_file() && name.to_lowercase().ends_with(".md") {
            let rel = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .components()
                .map(|c| c.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if out.len() >= limits.max_files {
                return Err(format!(
                    "vault has more than {} markdown notes; pick a smaller folder",
                    limits.max_files
                ));
            }
            let size = entry
                .metadata()
                .map_err(|e| format!("cannot stat {rel}: {e}"))?
                .len();
            if size > limits.max_file_bytes {
                return Err(format!(
                    "{rel} is {size} bytes, over the {} byte per-note limit",
                    limits.max_file_bytes
                ));
            }
            *total += size;
            if *total > limits.max_total_bytes {
                return Err(format!(
                    "vault is over the {} byte total limit",
                    limits.max_total_bytes
                ));
            }
            let bytes = std::fs::read(&path).map_err(|e| format!("cannot read {rel}: {e}"))?;
            let content =
                String::from_utf8(bytes).map_err(|_| format!("{rel} is not valid UTF-8 text"))?;
            out.push(VaultFile { path: rel, content });
        }
    }
    Ok(())
}

/// The canonical form of `dir` if the user picked exactly that folder this session.
pub fn granted_dir(granted: &[PathBuf], dir: &str) -> Result<PathBuf, String> {
    let canonical = PathBuf::from(dir)
        .canonicalize()
        .map_err(|e| format!("cannot open {dir}: {e}"))?;
    if granted.iter().any(|g| g == &canonical) {
        Ok(canonical)
    } else {
        Err(format!(
            "{} was not chosen in this session; use \"Choose folder…\"",
            canonical.display()
        ))
    }
}
