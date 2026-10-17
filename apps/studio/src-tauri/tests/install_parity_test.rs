//! Studio installs with the pure TS translate + Rust write_outputs; the CLI with the Node wrapper.
//! The TS side (apps/studio/test/install-fixtures.test.ts) proves `writes` is what the pure
//! translate produces and `tree` is what the CLI writes; this proves Rust read_inputs sees the
//! same bytes and write_outputs turns `writes` into exactly `tree` — so both paths are identical.
#![cfg(unix)]
use base64::Engine;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use uniqent_studio::fs_io::*;

fn fixture(target: &str) -> Value {
    let p = format!(
        "{}/../fixtures/install/{target}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

/// Every file under `dir` as root-relative POSIX path → (base64 bytes, mode is owner-only).
fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, (String, bool)>) {
    use std::os::unix::fs::PermissionsExt;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let meta = std::fs::symlink_metadata(&path).unwrap();
        if meta.is_dir() {
            walk(root, &path, out);
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let bytes = base64::engine::general_purpose::STANDARD.encode(std::fs::read(&path).unwrap());
        out.insert(rel, (bytes, meta.permissions().mode() & 0o077 == 0));
    }
}

fn snapshot(root: &Path) -> BTreeMap<String, (String, bool)> {
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

#[test]
fn studio_path_writes_the_cli_tree_for_every_target() {
    for target in ["claude-code", "hermes", "openclaw"] {
        let fx = fixture(target);
        let d = tempfile::tempdir().unwrap();
        for (path, text) in fx["seed"].as_object().unwrap() {
            let p = d.path().join(path);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, text.as_str().unwrap()).unwrap();
        }
        let files: Vec<String> = serde_json::from_value(fx["inputs"]["files"].clone()).unwrap();
        let finds: Vec<FindRequest> =
            serde_json::from_value(fx["inputs"]["finds"].clone()).unwrap();
        let read: BTreeMap<String, String> =
            read_inputs(d.path(), &files, &finds, &DEFAULT_IO_LIMITS)
                .unwrap()
                .into_iter()
                .map(|f| (f.path, f.bytes_base64))
                .collect();
        let want: BTreeMap<String, String> =
            serde_json::from_value(fx["inputs"]["read"].clone()).unwrap();
        assert_eq!(
            read, want,
            "{target}: read_inputs differs from what the TS translate consumed"
        );

        let writes: Vec<OutputWrite> = serde_json::from_value(fx["writes"].clone()).unwrap();
        write_outputs(d.path(), &writes).unwrap();
        let tree: BTreeMap<String, (String, bool)> = fx["tree"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    (
                        v["bytesBase64"].as_str().unwrap().into(),
                        v["ownerOnly"].as_bool().unwrap(),
                    ),
                )
            })
            .collect();
        assert_eq!(
            snapshot(d.path()),
            tree,
            "{target}: Studio tree differs from the CLI tree"
        );
        write_outputs(d.path(), &writes).unwrap();
        assert_eq!(
            snapshot(d.path()),
            tree,
            "{target}: second write changed the tree"
        );
    }
}
