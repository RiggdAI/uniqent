use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use uniqent_studio::core::archive::{pack, unpack};
use uniqent_studio::core::bundle::Bundle;
use uniqent_studio::core::digest::canonical_digest;
use uniqent_studio::core::signing::{generate_keypair, sign, verify};

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

#[test]
fn unpacks_the_ts_packed_fixture_to_the_same_digest() {
    let bytes = fs::read(core_fixtures().join("fixture.uniqent")).expect("fixture.uniqent");
    let b = unpack(&bytes).expect("TS-packed archive is readable");
    assert_eq!(canonical_digest(&b), expected_digest());
}

#[test]
fn rust_pack_roundtrips_and_preserves_digest() {
    let b = fixture_bundle();
    let packed = pack(&b).expect("packs");
    let back = unpack(&packed).expect("unpacks own output");
    assert_eq!(canonical_digest(&back), expected_digest());
}

#[test]
fn verifies_the_ts_signed_fixture() {
    let bytes = fs::read(core_fixtures().join("fixture-signed.uniqent")).expect("signed fixture");
    let b = unpack(&bytes).expect("unpacks");
    let kp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(core_fixtures().join("keypair.json")).unwrap()).unwrap();
    let v = verify(&b);
    assert!(v.signed && v.valid, "TS-signed bundle must verify in Rust: {:?}", v.reason);
    assert_eq!(v.public_key.as_deref(), kp["publicKey"].as_str());
}

#[test]
fn rust_sign_self_verifies_and_ts_keypair_signs() {
    // With the committed TS keypair: Rust-signed bundle verifies (same key derivation).
    let kp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(core_fixtures().join("keypair.json")).unwrap()).unwrap();
    let signed = sign(&fixture_bundle(), kp["privateKey"].as_str().unwrap()).expect("signs");
    let v = verify(&signed);
    assert!(v.signed && v.valid);
    assert_eq!(v.public_key.as_deref(), kp["publicKey"].as_str());
    // And a fresh Rust keypair round-trips too.
    let fresh = generate_keypair();
    let signed2 = sign(&fixture_bundle(), &fresh.private_key).expect("signs");
    assert!(verify(&signed2).valid);
}

#[test]
fn tampered_content_fails_verification_with_exact_reason() {
    let bytes = fs::read(core_fixtures().join("fixture-signed.uniqent")).unwrap();
    let mut b = unpack(&bytes).unwrap();
    b.set("README.md", b"tampered".to_vec());
    let v = verify(&b);
    assert!(v.signed && !v.valid);
    assert_eq!(v.reason.as_deref(), Some("digest mismatch (content changed)"));
}
