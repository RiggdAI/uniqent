use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use uniqent_studio::core::bundle::Bundle;
use uniqent_studio::core::digest::canonical_digest;

fn core_fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/core")
}

/// Load fixtures/core/files/** into a Bundle (paths relative, forward slashes).
fn fixture_bundle() -> Bundle {
    fn walk(dir: &Path, root: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for e in fs::read_dir(dir).expect("readable") {
            let p = e.expect("entry").path();
            if p.is_dir() {
                walk(&p, root, files);
            } else {
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                files.insert(rel, fs::read(&p).expect("file"));
            }
        }
    }
    let root = core_fixtures().join("files");
    let mut files = BTreeMap::new();
    walk(&root, &root, &mut files);
    Bundle::from_files(files)
}

fn expected_digest() -> String {
    fs::read_to_string(core_fixtures().join("expected-digest.txt"))
        .expect("digest fixture")
        .trim()
        .to_string()
}

#[test]
fn digest_matches_ts_core() {
    assert_eq!(canonical_digest(&fixture_bundle()), expected_digest());
}

#[test]
fn digest_ignores_signature_json() {
    let mut b = fixture_bundle();
    b.set("signature.json", b"{\"anything\": true}".to_vec());
    assert_eq!(canonical_digest(&b), expected_digest());
}

#[test]
fn digest_changes_when_content_changes() {
    let mut b = fixture_bundle();
    b.set("README.md", b"tampered".to_vec());
    assert_ne!(canonical_digest(&b), expected_digest());
}
