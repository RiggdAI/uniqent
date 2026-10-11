use std::fs;
use uniqent_studio::vault::{walk_vault, VaultLimits, DEFAULT_LIMITS};

fn tmp() -> tempfile::TempDir {
    tempfile::tempdir().unwrap()
}

#[test]
fn reads_markdown_with_posix_paths_and_skips_tooling_dirs() {
    let d = tmp();
    fs::create_dir_all(d.path().join("notes/sub")).unwrap();
    fs::create_dir_all(d.path().join(".obsidian")).unwrap();
    fs::create_dir_all(d.path().join("node_modules/pkg")).unwrap();
    fs::write(d.path().join("SOUL.md"), "soul").unwrap();
    fs::write(d.path().join("notes/sub/a.md"), "a").unwrap();
    fs::write(d.path().join("notes/b.txt"), "not md").unwrap();
    fs::write(d.path().join(".obsidian/workspace.md"), "skip").unwrap();
    fs::write(d.path().join("node_modules/pkg/README.md"), "skip").unwrap();
    let mut paths: Vec<String> = walk_vault(d.path(), &DEFAULT_LIMITS)
        .unwrap()
        .into_iter()
        .map(|f| f.path)
        .collect();
    paths.sort();
    assert_eq!(paths, vec!["SOUL.md", "notes/sub/a.md"]);
}

#[cfg(unix)]
#[test]
fn never_follows_symlinks_out_of_the_vault() {
    let outside = tmp();
    fs::write(outside.path().join("secret.md"), "id_rsa").unwrap();
    let d = tmp();
    std::os::unix::fs::symlink(outside.path(), d.path().join("link")).unwrap();
    std::os::unix::fs::symlink(outside.path().join("secret.md"), d.path().join("s.md")).unwrap();
    assert!(walk_vault(d.path(), &DEFAULT_LIMITS).unwrap().is_empty());
}

/// A note swapped for a symlink after the walk saw a regular file must not be followed.
#[cfg(unix)]
#[test]
fn reading_a_note_refuses_a_symlink_and_reads_at_most_the_limit() {
    use uniqent_studio::vault::read_note;
    let outside = tmp();
    fs::write(outside.path().join("secret.md"), "id_rsa").unwrap();
    let d = tmp();
    std::os::unix::fs::symlink(outside.path().join("secret.md"), d.path().join("s.md")).unwrap();
    let err = read_note(&d.path().join("s.md"), "s.md", 1024).unwrap_err();
    assert!(err.contains("s.md"), "{err}");

    fs::write(d.path().join("big.md"), "x".repeat(2048)).unwrap();
    let err = read_note(&d.path().join("big.md"), "big.md", 1024).unwrap_err();
    assert!(err.contains("big.md") && err.contains("1024"), "{err}");
    assert_eq!(
        read_note(&d.path().join("big.md"), "big.md", 4096)
            .unwrap()
            .len(),
        2048
    );
}

#[test]
fn fails_with_a_clear_error_past_the_limits() {
    let d = tmp();
    for i in 0..3 {
        fs::write(d.path().join(format!("{i}.md")), "x").unwrap();
    }
    let tight = VaultLimits {
        max_files: 2,
        max_file_bytes: 1024,
        max_total_bytes: 1024,
    };
    let err = walk_vault(d.path(), &tight).unwrap_err();
    assert!(err.contains("more than 2"), "{err}");

    fs::write(d.path().join("big.md"), "x".repeat(2048)).unwrap();
    let per_file = VaultLimits {
        max_files: 100,
        max_file_bytes: 1024,
        max_total_bytes: 1_000_000,
    };
    let err = walk_vault(d.path(), &per_file).unwrap_err();
    assert!(err.contains("big.md"), "{err}");
}

#[test]
fn rejects_non_utf8_notes_by_name() {
    let d = tmp();
    fs::write(d.path().join("bad.md"), [0xff, 0xfe, 0xfd]).unwrap();
    let err = walk_vault(d.path(), &DEFAULT_LIMITS).unwrap_err();
    assert!(err.contains("bad.md") && err.contains("UTF-8"), "{err}");
}

#[test]
fn only_folders_picked_this_session_can_be_read() {
    use uniqent_studio::vault::granted_dir;
    let picked = tmp();
    let other = tmp();
    let granted = vec![picked.path().canonicalize().unwrap()];
    let ok = granted_dir(&granted, picked.path().to_str().unwrap()).unwrap();
    assert_eq!(ok, picked.path().canonicalize().unwrap());
    let err = granted_dir(&granted, other.path().to_str().unwrap()).unwrap_err();
    assert!(err.contains("Choose folder"), "{err}");
    // Only the exact picked folder is readable — not a subfolder named by path.
    let sub = picked.path().join("sub");
    fs::create_dir_all(&sub).unwrap();
    let err = granted_dir(&granted, sub.to_str().unwrap()).unwrap_err();
    assert!(err.contains("Choose folder"), "{err}");
}
