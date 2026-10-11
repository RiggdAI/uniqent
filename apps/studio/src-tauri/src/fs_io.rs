//! Confined file I/O for install and capture. Paths are relative to an allowed root, never
//! absolute or `..`, never through a symlink. Writes are atomic and owner-only (0600) when they
//! hold secrets. File content never appears in an error.
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

/// Mode for files holding resolved secrets (TS `OWNER_ONLY`).
pub const OWNER_ONLY: u32 = 0o600;

/// Every file named `file_name` under `root/dir` at any depth (TS `FindRef` without `root`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRequest {
    pub dir: String,
    pub file_name: String,
    pub skip_dirs: Vec<String>,
}

/// One file read: its root-relative POSIX path and its bytes.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadFile {
    pub path: String,
    pub bytes_base64: String,
}

/// One file to write (TS `OutputWrite` without `root`). No `Debug`: the bytes may hold secrets.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputWrite {
    pub path: String,
    pub bytes_base64: String,
    pub mode: Option<u32>,
}

pub struct IoLimits {
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
}

/// 2000 files, 8 MiB per file, 64 MiB per call.
pub const DEFAULT_IO_LIMITS: IoLimits = IoLimits {
    max_files: 2000,
    max_file_bytes: 8 << 20,
    max_total_bytes: 64 << 20,
};

/// Root-relative POSIX path → normal components. Err for empty, absolute, `.`/`..`, `\`, NUL,
/// `:` (a Windows `C:` segment would replace the root).
pub fn relative_components(path: &str) -> Result<Vec<String>, String> {
    let segments: Vec<&str> = path.split('/').collect();
    let unsafe_path = path.contains(['\\', '\0', ':'])
        || segments
            .iter()
            .any(|s| s.is_empty() || *s == "." || *s == "..");
    if unsafe_path {
        return Err(format!(
            "\"{path}\" is not a safe relative path: it must stay inside the root \
             (no leading /, no empty, . or .. segments, no \\, : or NUL)"
        ));
    }
    Ok(segments.into_iter().map(String::from).collect())
}

/// The path to `root/components…` after checking no existing component is a symlink.
fn checked(root: &Path, components: &[String]) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    for c in components {
        p.push(c);
        match std::fs::symlink_metadata(&p) {
            Ok(m) if m.file_type().is_symlink() => {
                return Err(format!("refusing {}: it is a symlink", p.display()))
            }
            Ok(_) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(format!("cannot stat {}: {e}", p.display())),
        }
    }
    Ok(p)
}

/// Read `files` (absent ones omitted) and every `finds` match; refuses any symlinked component.
pub fn read_inputs(
    root: &Path,
    files: &[String],
    finds: &[FindRequest],
    limits: &IoLimits,
) -> Result<Vec<ReadFile>, String> {
    let mut out = Vec::new();
    let mut total: u64 = 0;
    for path in files {
        let abs = checked(root, &relative_components(path)?)?;
        match std::fs::symlink_metadata(&abs) {
            Ok(_) => read_one(&abs, path, limits, &mut out, &mut total)?,
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(format!("cannot stat {}: {e}", abs.display())),
        }
    }
    for find in finds {
        let dir = checked(root, &relative_components(&find.dir)?)?;
        walk(&dir, &find.dir, find, limits, &mut out, &mut total)?;
    }
    Ok(out)
}

/// Every `find.file_name` under `dir` (absent dir → none). Dot entries and `skip_dirs` are
/// skipped; any other symlink is refused by name (never followed, never silently dropped).
fn walk(
    dir: &Path,
    rel_dir: &str,
    find: &FindRequest,
    limits: &IoLimits,
    out: &mut Vec<ReadFile>,
    total: &mut u64,
) -> Result<(), String> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(format!("cannot read {}: {e}", dir.display())),
    };
    for entry in entries {
        let entry = entry.map_err(|e| format!("cannot read {}: {e}", dir.display()))?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || find.skip_dirs.contains(&name) {
            continue;
        }
        let abs = entry.path();
        let rel = format!("{rel_dir}/{name}");
        // file_type() does not follow symlinks.
        let file_type = entry
            .file_type()
            .map_err(|e| format!("cannot stat {}: {e}", abs.display()))?;
        if file_type.is_symlink() {
            return Err(format!(
                "refusing to read {}: it is a symlink. Replace it with a real copy of what it \
                 points to (or export from the real location), then re-run.",
                abs.display()
            ));
        }
        if file_type.is_dir() {
            walk(&abs, &rel, find, limits, out, total)?;
        } else if file_type.is_file() && name == find.file_name {
            read_one(&abs, &rel, limits, out, total)?;
        }
    }
    Ok(())
}

/// Read `abs` (never through a symlink, within the limits) and append it as `rel`, once: a file
/// both named and found is read and counted a single time (like the TS map keyed by path).
fn read_one(
    abs: &Path,
    rel: &str,
    limits: &IoLimits,
    out: &mut Vec<ReadFile>,
    total: &mut u64,
) -> Result<(), String> {
    if out.iter().any(|f| f.path == rel) {
        return Ok(());
    }
    let label = abs.display().to_string();
    if out.len() >= limits.max_files {
        return Err(format!(
            "cannot read {label}: over the {} file limit for one read",
            limits.max_files
        ));
    }
    let bytes = crate::vault::read_note(abs, &label, limits.max_file_bytes)?;
    *total += bytes.len() as u64;
    if *total > limits.max_total_bytes {
        return Err(format!(
            "cannot read {label}: over the {} byte total limit for one read",
            limits.max_total_bytes
        ));
    }
    out.push(ReadFile {
        path: rel.to_string(),
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    });
    Ok(())
}

/// A validated write: its components, decoded bytes and mode.
struct Planned {
    components: Vec<String>,
    bytes: Vec<u8>,
    mode: Option<u32>,
}

/// Check one write's path (relative, no symlink on the way), mode and base64 without writing.
fn plan_write(root: &Path, write: &OutputWrite) -> Result<Planned, String> {
    let components = relative_components(&write.path)?;
    if let Some(mode) = write.mode.filter(|m| *m != OWNER_ONLY) {
        return Err(format!(
            "{}: mode {mode:o} is not allowed; use {OWNER_ONLY:o} (owner-only) or none",
            write.path
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&write.bytes_base64)
        .map_err(|_| format!("{}: bytesBase64 is not valid base64", write.path))?;
    checked(root, &components)?;
    Ok(Planned {
        components,
        bytes,
        mode: write.mode,
    })
}

/// Validate every write first (path, base64, mode ∈ {None, Some(0o600)}, no duplicates), then
/// write each atomically: a 0600 temp file in the same dir → final mode → fsync → rename. The
/// final mode is 0600 for `Some(0o600)`; for `None` an existing target's permissions, else
/// 0666 & ~umask (what the CLI's `writeFile` creates).
/// Returns the written paths. Never follows or replaces through a symlinked parent.
pub fn write_outputs(root: &Path, writes: &[OutputWrite]) -> Result<Vec<String>, String> {
    let planned = writes
        .iter()
        .map(|w| plan_write(root, w))
        .collect::<Result<Vec<_>, String>>()?;
    let mut seen = HashSet::new();
    if let Some(dup) = writes.iter().find(|w| !seen.insert(w.path.as_str())) {
        return Err(format!("{} is written twice in one install", dup.path));
    }
    for p in &planned {
        write_one(root, &p.components, &p.bytes, p.mode)?;
    }
    Ok(writes.iter().map(|w| w.path.clone()).collect())
}

#[cfg(unix)]
fn write_one(root: &Path, comps: &[String], bytes: &[u8], mode: Option<u32>) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let target = checked(root, comps)?;
    let parent = target.parent().expect("a checked path has a parent");
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    checked(root, comps)?; // re-check after creating parents
    let existing = match std::fs::symlink_metadata(&target) {
        Ok(m) if m.is_dir() => {
            return Err(format!(
                "cannot write {}: a directory is in the way",
                target.display()
            ))
        }
        Ok(m) if m.is_file() => Some(m.permissions()),
        Ok(_) => {
            return Err(format!(
                "cannot write {}: it is not a regular file",
                target.display()
            ))
        }
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        Err(e) => return Err(format!("cannot stat {}: {e}", target.display())),
    };
    let final_mode = match (mode, existing) {
        (Some(_), _) => std::fs::Permissions::from_mode(OWNER_ONLY),
        (None, Some(p)) => p,
        (None, None) => std::fs::Permissions::from_mode(0o666 & !process_umask()),
    };
    let mut suffix = [0u8; 6];
    getrandom::fill(&mut suffix).map_err(|e| format!("OS random source unavailable: {e}"))?;
    let name = comps.last().expect("a relative path has a component");
    let tmp = parent.join(format!(".{name}.uniqent-{}", hex::encode(suffix)));
    // Every temp starts owner-only, so no other user can open it while the bytes go in.
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(OWNER_ONLY)
        .open(&tmp)
        .map_err(|e| format!("cannot create a temp file in {}: {e}", parent.display()))?;
    let result = (|| {
        f.write_all(bytes)
            .map_err(|e| format!("cannot write {}: {e}", target.display()))?;
        f.set_permissions(final_mode)
            .map_err(|e| format!("cannot set the mode of {}: {e}", target.display()))?;
        f.sync_all()
            .map_err(|e| format!("cannot write {}: {e}", target.display()))?;
        std::fs::rename(&tmp, &target)
            .map_err(|e| format!("cannot replace {}: {e}", target.display()))
    })();
    if result.is_err() {
        // The temp file is ours (created above). The write's own error is what matters; a
        // leftover temp file is the lesser problem.
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

/// The process umask, read once. Reading it means setting it: the swap briefly sets 0o077, so a
/// file another thread creates in that instant only ever comes out stricter, never looser.
#[cfg(unix)]
fn process_umask() -> u32 {
    static UMASK: std::sync::OnceLock<u32> = std::sync::OnceLock::new();
    *UMASK.get_or_init(|| {
        // SAFETY: umask only swaps the process file-mode creation mask and cannot fail.
        let old = unsafe { libc::umask(0o077) };
        unsafe { libc::umask(old) };
        #[allow(clippy::unnecessary_cast)] // mode_t is u16 on macOS, u32 on Linux
        let old = old as u32;
        old
    })
}

#[cfg(not(unix))]
fn write_one(
    _root: &Path,
    _comps: &[String],
    _bytes: &[u8],
    _mode: Option<u32>,
) -> Result<(), String> {
    Err("install is supported on macOS/Linux only for now".into())
}

/// The names (each a single path segment) that exist in `dir`, following symlinks like the CLI's
/// project-marker probe.
pub fn folder_markers(dir: &Path, names: &[String]) -> Result<Vec<String>, String> {
    let mut present = Vec::new();
    for name in names {
        if relative_components(name)?.len() != 1 {
            return Err(format!(
                "marker \"{name}\" must be a single file or folder name"
            ));
        }
        let p = dir.join(name);
        if p.try_exists()
            .map_err(|e| format!("cannot stat {}: {e}", p.display()))?
        {
            present.push(name.clone());
        }
    }
    Ok(present)
}

/// The process environment that decides where frameworks live.
pub struct HomeEnv {
    pub home: PathBuf,
    pub hermes_home: Option<PathBuf>,
    pub openclaw_state_dir: Option<PathBuf>,
}

impl HomeEnv {
    /// `HOME` is required and must be absolute. An empty variable counts as unset (the CLI's
    /// `||`); a framework variable is kept as given and checked by `safe_home` when it is used.
    pub fn from_process() -> Result<Self, String> {
        let home = env_path("HOME")
            .ok_or("HOME is not set; Studio needs it to find the framework folders")?;
        if !home.is_absolute() {
            return Err(format!(
                "HOME is \"{}\"; it must be an absolute path",
                home.display()
            ));
        }
        Ok(Self {
            home,
            hermes_home: env_path("HERMES_HOME"),
            openclaw_state_dir: env_path("OPENCLAW_STATE_DIR"),
        })
    }
}

fn env_path(name: &str) -> Option<PathBuf> {
    std::env::var_os(name)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// ("hermes", $HERMES_HOME or ~/.hermes), ("openclaw", $OPENCLAW_STATE_DIR or ~/.openclaw) — cli/src/targets.ts defaultRoot rules.
pub fn framework_homes(env: &HomeEnv) -> Vec<(&'static str, PathBuf)> {
    vec![
        (
            "hermes",
            env.hermes_home
                .clone()
                .unwrap_or_else(|| env.home.join(".hermes")),
        ),
        (
            "openclaw",
            env.openclaw_state_dir
                .clone()
                .unwrap_or_else(|| env.home.join(".openclaw")),
        ),
    ]
}

/// `path` canonicalized through its nearest existing ancestor, the missing rest appended.
fn canonical_through_ancestor(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("{} must be an absolute path", path.display()));
    }
    if path
        .components()
        .any(|c| matches!(c, Component::CurDir | Component::ParentDir))
    {
        return Err(format!(
            "{} must not contain . or .. segments",
            path.display()
        ));
    }
    let mut existing = path;
    let mut missing = Vec::new();
    loop {
        match existing.canonicalize() {
            Ok(canonical) => {
                return Ok(missing
                    .iter()
                    .rev()
                    .fold(canonical, |acc: PathBuf, name| acc.join(name)))
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {
                if std::fs::symlink_metadata(existing).is_ok() {
                    return Err(format!("{} is a dangling symlink", existing.display()));
                }
                let (Some(name), Some(parent)) = (existing.file_name(), existing.parent()) else {
                    return Err(format!(
                        "cannot resolve {}: no existing ancestor",
                        path.display()
                    ));
                };
                missing.push(name);
                existing = parent;
            }
            Err(e) => return Err(format!("cannot resolve {}: {e}", existing.display())),
        }
    }
}

/// A framework home's canonical form. Refused when it is not absolute or contains the user's
/// home folder (`/`, `$HOME` or an ancestor): allowing it would allow every folder.
pub fn safe_home(id: &str, path: &Path, home: &Path) -> Result<PathBuf, String> {
    let canonical = canonical_through_ancestor(path)
        .map_err(|e| format!("the {id} folder is unusable: {e}"))?;
    if canonical_through_ancestor(home)?.starts_with(&canonical) {
        return Err(format!(
            "the {id} folder {} contains your home folder, so Studio will not use it; point \
             HERMES_HOME / OPENCLAW_STATE_DIR (or the symlink) at a folder of its own",
            path.display()
        ));
    }
    Ok(canonical)
}

/// `root` must be absolute; canonicalized through its nearest existing ancestor (the rest must be
/// normal components). Allowed when it equals or lies under a granted folder (already canonical:
/// stored by `pick_folder`, never re-resolved) or a `safe_home` framework home. An unusable home
/// does not block other roots; it is named in the refusal.
pub fn allowed_root(root: &str, granted: &[PathBuf], env: &HomeEnv) -> Result<PathBuf, String> {
    let candidate = canonical_through_ancestor(Path::new(root))?;
    if granted.iter().any(|g| candidate.starts_with(g)) {
        return Ok(candidate);
    }
    let mut unusable = Vec::new();
    for (id, path) in framework_homes(env) {
        match safe_home(id, &path, &env.home) {
            Ok(home) if candidate.starts_with(&home) => return Ok(candidate),
            Ok(_) => {}
            Err(e) => unusable.push(e),
        }
    }
    let refusal = format!(
        "{root} is outside the folders Studio may use; pick it with \"Choose folder…\" first"
    );
    if unusable.is_empty() {
        Err(refusal)
    } else {
        Err(format!("{refusal} ({})", unusable.join("; ")))
    }
}
