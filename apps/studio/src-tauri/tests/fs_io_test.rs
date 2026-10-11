use base64::Engine;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use uniqent_studio::fs_io::*;

fn b64(s: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(s)
}
fn w(path: &str, body: &str, mode: Option<u32>) -> OutputWrite {
    OutputWrite {
        path: path.into(),
        bytes_base64: b64(body.as_bytes()),
        mode,
    }
}
#[cfg(unix)]
fn mode_of(p: &std::path::Path) -> u32 {
    fs::metadata(p).unwrap().permissions().mode() & 0o777
}

#[test]
fn rejects_paths_that_leave_the_root() {
    let d = tempfile::tempdir().unwrap();
    for bad in [
        "/etc/passwd",
        "../x",
        "a/../../x",
        "a\\b",
        "",
        "./a",
        "a//b",
    ] {
        let err = write_outputs(d.path(), &[w(bad, "x", None)]).unwrap_err();
        assert!(err.contains(bad) || bad.is_empty(), "{err}");
    }
}

#[cfg(unix)]
#[test]
fn never_writes_through_a_symlink() {
    let outside = tempfile::tempdir().unwrap();
    let d = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), d.path().join("memories")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("t.md"), d.path().join("AGENTS.md")).unwrap();
    assert!(
        write_outputs(d.path(), &[w("memories/MEMORY.md", "x", None)])
            .unwrap_err()
            .contains("symlink")
    );
    assert!(write_outputs(d.path(), &[w("AGENTS.md", "x", None)])
        .unwrap_err()
        .contains("symlink"));
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[cfg(unix)]
#[test]
fn secret_files_end_up_owner_only_and_others_keep_their_mode() {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join(".env"), "OLD=1\n").unwrap();
    fs::set_permissions(d.path().join(".env"), fs::Permissions::from_mode(0o644)).unwrap();
    fs::write(d.path().join("SOUL.md"), "old").unwrap();
    fs::set_permissions(d.path().join("SOUL.md"), fs::Permissions::from_mode(0o640)).unwrap();
    write_outputs(
        d.path(),
        &[
            w(".env", "K=v\n", Some(OWNER_ONLY)),
            w("SOUL.md", "new", None),
        ],
    )
    .unwrap();
    assert_eq!(mode_of(&d.path().join(".env")), 0o600);
    assert_eq!(mode_of(&d.path().join("SOUL.md")), 0o640);
    write_outputs(d.path(), &[w("skills/x/SKILL.md", "s", None)]).unwrap();
    assert_eq!(mode_of(&d.path().join("skills/x/SKILL.md")) & 0o600, 0o600);
    assert_ne!(
        mode_of(&d.path().join("skills/x/SKILL.md")),
        0o600,
        "new non-secret files are not owner-only"
    );
}

#[test]
fn validates_everything_before_writing_anything() {
    let d = tempfile::tempdir().unwrap();
    let err =
        write_outputs(d.path(), &[w("ok.md", "x", None), w("../bad", "x", None)]).unwrap_err();
    assert!(err.contains("../bad"), "{err}");
    assert!(!d.path().join("ok.md").exists());
    assert!(write_outputs(d.path(), &[w("a.md", "x", Some(0o644))])
        .unwrap_err()
        .contains("mode"));
}

#[test]
fn rewriting_is_idempotent_and_leaves_no_temp_files() {
    let d = tempfile::tempdir().unwrap();
    let writes = [w("a/b.md", "same", None)];
    write_outputs(d.path(), &writes).unwrap();
    write_outputs(d.path(), &writes).unwrap();
    assert_eq!(fs::read_to_string(d.path().join("a/b.md")).unwrap(), "same");
    let names: Vec<_> = fs::read_dir(d.path().join("a"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(names.len(), 1, "{names:?}");
}

#[test]
fn errors_never_contain_file_content() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir(d.path().join(".env")).unwrap(); // a dir where a file must go
    let err =
        write_outputs(d.path(), &[w(".env", "SECRET_VALUE_123", Some(OWNER_ONLY))]).unwrap_err();
    assert!(
        !err.contains("SECRET_VALUE_123") && !err.contains(&b64(b"SECRET_VALUE_123")),
        "{err}"
    );
}

fn skills_find() -> FindRequest {
    FindRequest {
        dir: "skills".into(),
        file_name: "SKILL.md".into(),
        skip_dirs: vec!["venv".into()],
    }
}

#[test]
fn reads_omit_absent_files_and_finds_skip_dot_and_skip_dirs() {
    let d = tempfile::tempdir().unwrap();
    for p in ["skills/a", "skills/.git/h", "skills/venv/v", "skills/g/b"] {
        fs::create_dir_all(d.path().join(p)).unwrap();
        fs::write(d.path().join(p).join("SKILL.md"), p).unwrap();
    }
    fs::write(d.path().join("SOUL.md"), "soul").unwrap();
    let got = read_inputs(
        d.path(),
        &["SOUL.md".into(), "missing.md".into()],
        &[skills_find()],
        &DEFAULT_IO_LIMITS,
    )
    .unwrap();
    let mut paths: Vec<_> = got.iter().map(|f| f.path.clone()).collect();
    paths.sort();
    assert_eq!(
        paths,
        vec!["SOUL.md", "skills/a/SKILL.md", "skills/g/b/SKILL.md"]
    );
    let soul = got.iter().find(|f| f.path == "SOUL.md").unwrap();
    assert_eq!(soul.bytes_base64, b64(b"soul"));
}

/// Like the CLI's find walk: a symlink under a find dir is refused by name, never followed or
/// silently dropped (a dot-named or skip_dirs symlink is skipped before that check).
#[cfg(unix)]
#[test]
fn finds_refuse_a_symlinked_entry_by_name() {
    let outside = tempfile::tempdir().unwrap();
    fs::create_dir_all(outside.path().join("evil")).unwrap();
    fs::write(outside.path().join("evil/SKILL.md"), "x").unwrap();
    let d = tempfile::tempdir().unwrap();
    fs::create_dir_all(d.path().join("skills/a")).unwrap();
    std::os::unix::fs::symlink(outside.path(), d.path().join("skills/.hidden")).unwrap();
    std::os::unix::fs::symlink(outside.path(), d.path().join("skills/venv")).unwrap();
    assert!(read_inputs(d.path(), &[], &[skills_find()], &DEFAULT_IO_LIMITS).is_ok());

    std::os::unix::fs::symlink(outside.path(), d.path().join("skills/a/link")).unwrap();
    let err = read_inputs(d.path(), &[], &[skills_find()], &DEFAULT_IO_LIMITS).unwrap_err();
    assert!(
        err.contains("symlink") && err.contains("skills/a/link"),
        "{err}"
    );
}

#[test]
fn only_granted_folders_and_framework_homes_are_allowed_roots() {
    let home = tempfile::tempdir().unwrap();
    let picked = tempfile::tempdir().unwrap();
    let env = HomeEnv {
        home: home.path().into(),
        hermes_home: None,
        openclaw_state_dir: None,
    };
    let homes: Vec<_> = framework_homes(&env).into_iter().map(|(_, p)| p).collect();
    let granted = vec![picked.path().canonicalize().unwrap()];
    // A framework home that does not exist yet is allowed (first install creates it).
    assert!(allowed_root(
        home.path().join(".hermes").to_str().unwrap(),
        &granted,
        &homes
    )
    .is_ok());
    assert!(allowed_root(
        home.path().join(".openclaw/workspace").to_str().unwrap(),
        &granted,
        &homes
    )
    .is_ok());
    assert!(allowed_root(
        picked.path().join("proj").to_str().unwrap(),
        &granted,
        &homes
    )
    .is_ok());
    for bad in [home.path().join(".ssh"), home.path().to_path_buf()] {
        let err = allowed_root(bad.to_str().unwrap(), &granted, &homes).unwrap_err();
        assert!(err.contains("Choose folder"), "{err}");
    }
    assert!(allowed_root("relative/dir", &granted, &homes).is_err());
    assert!(allowed_root(
        &format!("{}/.hermes/../.ssh", home.path().display()),
        &granted,
        &homes
    )
    .is_err());
}

#[test]
fn read_limits_fail_loudly() {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join("big.md"), "x".repeat(2048)).unwrap();
    let limits = IoLimits {
        max_files: 10,
        max_file_bytes: 1024,
        max_total_bytes: 1 << 20,
    };
    assert!(read_inputs(d.path(), &["big.md".into()], &[], &limits)
        .unwrap_err()
        .contains("big.md"));
}

#[test]
fn folder_markers_name_what_exists_and_refuse_nested_names() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir(d.path().join(".claude")).unwrap();
    fs::write(d.path().join("SOUL.md"), "s").unwrap();
    let names: Vec<String> = [".claude", "openclaw.json", "SOUL.md"]
        .map(String::from)
        .into();
    assert_eq!(
        folder_markers(d.path(), &names).unwrap(),
        vec![".claude", "SOUL.md"]
    );
    assert!(folder_markers(d.path(), &["a/b".into()]).is_err());
    assert!(folder_markers(d.path(), &["..".into()]).is_err());
}
