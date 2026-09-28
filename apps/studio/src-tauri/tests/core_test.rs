use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use uniqent_studio::core::archive::{pack, pack_checked, unpack};
use uniqent_studio::core::bundle::Bundle;
use uniqent_studio::core::digest::canonical_digest;
use uniqent_studio::core::secret_scan::scan_for_secrets;
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
                let rel = p
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                files.insert(rel, fs::read(&p).expect("file"));
            }
        }
    }
    let root = core_fixtures().join("files");
    let mut files = BTreeMap::new();
    walk(&root, &root, &mut files);
    Bundle::from_files(files).expect("fixture paths are valid")
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
    b.set("signature.json", b"{\"anything\": true}".to_vec())
        .unwrap();
    assert_eq!(canonical_digest(&b), expected_digest());
}

#[test]
fn digest_changes_when_content_changes() {
    let mut b = fixture_bundle();
    b.set("README.md", b"tampered".to_vec()).unwrap();
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
        serde_json::from_str(&fs::read_to_string(core_fixtures().join("keypair.json")).unwrap())
            .unwrap();
    let v = verify(&b);
    assert!(
        v.signed && v.valid,
        "TS-signed bundle must verify in Rust: {:?}",
        v.reason
    );
    assert_eq!(v.public_key.as_deref(), kp["publicKey"].as_str());
}

#[test]
fn rust_sign_self_verifies_and_ts_keypair_signs() {
    // With the committed TS keypair: Rust-signed bundle verifies (same key derivation).
    let kp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(core_fixtures().join("keypair.json")).unwrap())
            .unwrap();
    let signed = sign(&fixture_bundle(), kp["privateKey"].as_str().unwrap()).expect("signs");
    let v = verify(&signed);
    assert!(v.signed && v.valid);
    assert_eq!(v.public_key.as_deref(), kp["publicKey"].as_str());
    // And a fresh Rust keypair round-trips too.
    let fresh = generate_keypair().expect("keypair");
    let signed2 = sign(&fixture_bundle(), &fresh.private_key).expect("signs");
    assert!(verify(&signed2).valid);
}

#[test]
fn tampered_content_fails_verification_with_exact_reason() {
    let bytes = fs::read(core_fixtures().join("fixture-signed.uniqent")).unwrap();
    let mut b = unpack(&bytes).unwrap();
    b.set("README.md", b"tampered".to_vec()).unwrap();
    let v = verify(&b);
    assert!(v.signed && !v.valid);
    assert_eq!(
        v.reason.as_deref(),
        Some("digest mismatch (content changed)")
    );
}

// ---------------------------------------------------------------------------
// Task 4: secret-scan gate tests
// ---------------------------------------------------------------------------

#[test]
fn clean_fixture_has_no_findings_and_packs() {
    assert!(scan_for_secrets(&fixture_bundle()).is_empty());
    assert!(pack_checked(&fixture_bundle()).is_ok());
}

#[test]
fn a_planted_secret_blocks_pack_and_sign() {
    let mut b = fixture_bundle();
    // Canonical AWS access key — exactly the format the TS scanner catches (AKIA[0-9A-Z]{16})
    // Using the same string as the TS test suite (secret-scan.test.ts line 23).
    b.set(
        "mcp/servers.json",
        br#"{"env": {"AWS_SECRET_ACCESS_KEY": "AKIAIOSFODNN7EXAMPLE"}}"#.to_vec(),
    )
    .unwrap();
    assert!(
        !scan_for_secrets(&b).is_empty(),
        "planted AWS key must be found"
    );
    assert!(
        pack_checked(&b).is_err(),
        "pack_checked must block when secret found"
    );
    let kp = generate_keypair().expect("keypair");
    assert!(
        sign(&b, &kp.private_key).is_err(),
        "sign must gate on the scan"
    );
}

// Additional planted-secret cases mirroring the TS test suite (secret-scan.test.ts)

#[test]
fn detects_openai_key() {
    // TS test: 'token: sk-abcdefghijklmnopqrstuvwxyz0123456789'
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set(
        "notes.md",
        b"token: sk-abcdefghijklmnopqrstuvwxyz0123456789".to_vec(),
    )
    .unwrap();
    let findings = scan_for_secrets(&b);
    assert!(!findings.is_empty());
    assert!(
        findings[0].hint.starts_with("openai:"),
        "expected openai hint, got: {}",
        findings[0].hint
    );
}

#[test]
fn detects_github_pat() {
    // TS test: 'ghp_0123456789abcdefghijklmnopqrstuvwx'
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set("a.md", b"ghp_0123456789abcdefghijklmnopqrstuvwx".to_vec())
        .unwrap();
    let findings = scan_for_secrets(&b);
    assert!(!findings.is_empty());
    assert!(findings[0].hint.starts_with("github-pat:"));
}

#[test]
fn detects_slack_token() {
    // TS test: 'xoxb-0123456789-abcdefghij'
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set("b.md", b"xoxb-0123456789-abcdefghij".to_vec())
        .unwrap();
    let findings = scan_for_secrets(&b);
    assert!(!findings.is_empty());
    assert!(findings[0].hint.starts_with("slack:"));
}

#[test]
fn detects_aws_access_key() {
    // TS test: 'AKIAIOSFODNN7EXAMPLE'
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set("c.md", b"AKIAIOSFODNN7EXAMPLE".to_vec()).unwrap();
    let findings = scan_for_secrets(&b);
    assert!(!findings.is_empty());
    assert!(findings[0].hint.starts_with("aws-access-key:"));
}

#[test]
fn detects_private_key_pem_block() {
    // TS test: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----'
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set(
        "d.md",
        b"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----".to_vec(),
    )
    .unwrap();
    let findings = scan_for_secrets(&b);
    assert!(!findings.is_empty());
    assert!(findings[0].hint.starts_with("private-key:"));
}

#[test]
fn detects_high_entropy_token() {
    // TS test: 'value=Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv'
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set(
        "a.md",
        b"value=Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv".to_vec(),
    )
    .unwrap();
    let findings = scan_for_secrets(&b);
    assert!(
        findings.iter().any(|f| f.hint.starts_with("high-entropy:")),
        "expected high-entropy finding"
    );
}

#[test]
fn does_not_flag_natural_identifiers_and_paths() {
    // TS test: long underscored identifiers and URL/file paths that break into short segments
    let text = [
        "Use dataforseo_labs_google_competitors_domain and dataforseo_labs_bulk_keyword_difficulty.",
        "See https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
        "Refs live at skills/seo-geo/references/google-ai-optimization-guide.",
        "A mixed-case path: claude/skills/gstack/codex/SKILL.md and .factory/skills/gstack-qa.",
        "An all-caps constant: DATAFORSEO_LABS_BULK_TRAFFIC_ESTIMATION.",
    ]
    .join("\n");
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set("skills/seo/SKILL.md", text.into_bytes()).unwrap();
    assert!(
        scan_for_secrets(&b).is_empty(),
        "natural identifiers must not be flagged"
    );
}

#[test]
fn allows_credential_ref_placeholders() {
    // TS test: mcp/servers.json with ${credentialRef:github_pat}
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set(
        "mcp/servers.json",
        serde_json::to_vec(&serde_json::json!({"token": "${credentialRef:github_pat}"})).unwrap(),
    )
    .unwrap();
    assert!(
        scan_for_secrets(&b).is_empty(),
        "credentialRef placeholders must be allowed"
    );
}

#[test]
fn json_file_with_two_secrets_yields_two_findings() {
    // TS parity: walkJson calls record(detect(s)) for EVERY string node,
    // so a JSON file with two distinct secrets produces two findings.
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set(
        "config.json",
        serde_json::to_vec(&serde_json::json!({
            "openai_key":  "sk-abcdefghijklmnopqrstuvwxyz0123456789",
            "github_token": "ghp_0123456789abcdefghijklmnopqrstuvwx",
        }))
        .unwrap(),
    )
    .unwrap();
    let findings = scan_for_secrets(&b);
    assert_eq!(
        findings.len(),
        2,
        "expected 2 findings for a JSON file with two secrets, got: {findings:?}"
    );
    let hints: Vec<&str> = findings.iter().map(|f| f.hint.as_str()).collect();
    assert!(
        hints.iter().any(|h| h.starts_with("openai:")),
        "missing openai finding"
    );
    assert!(
        hints.iter().any(|h| h.starts_with("github-pat:")),
        "missing github-pat finding"
    );
}

#[test]
fn skips_signature_json_and_allowlists_pubkey() {
    // TS test: signature.json with long base64 strings; uniqent.json pubkey
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    b.set(
        "signature.json",
        serde_json::to_vec(&serde_json::json!({
            "signature": "A".repeat(88),
            "publicKey": "B".repeat(64),
        }))
        .unwrap(),
    )
    .unwrap();
    b.set(
        "uniqent.json",
        serde_json::to_vec(&serde_json::json!({
            "author": {"name": "x", "pubkey": "deadbeef".repeat(8)},
        }))
        .unwrap(),
    )
    .unwrap();
    assert!(
        scan_for_secrets(&b).is_empty(),
        "signature.json and pubkey values must be skipped"
    );
}

// ---------------------------------------------------------------------------
// Path / entry hardening (parity with the TS core `assertBundlePath` + `unpack`)
// ---------------------------------------------------------------------------

/// Gzip a raw tar built from (name, entry type, data) triples, bypassing the tar crate's own
/// path checks so malicious names reach `unpack`.
fn raw_archive(entries: &[(&str, tar::EntryType, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut tar_bytes: Vec<u8> = Vec::new();
    for (name, kind, data) in entries {
        let mut h = tar::Header::new_ustar();
        h.as_mut_bytes()[..name.len()].copy_from_slice(name.as_bytes());
        h.set_entry_type(*kind);
        h.set_size(data.len() as u64);
        h.set_mode(0o644);
        if *kind == tar::EntryType::Symlink {
            h.set_link_name("/etc/passwd").unwrap();
        }
        h.set_cksum();
        tar_bytes.extend_from_slice(h.as_bytes());
        tar_bytes.extend_from_slice(data);
        tar_bytes.resize(tar_bytes.len().div_ceil(512) * 512, 0);
    }
    tar_bytes.extend_from_slice(&[0u8; 1024]);
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(&tar_bytes).unwrap();
    gz.finish().unwrap()
}

/// The error `unpack` must return for a malformed archive.
fn unpack_err(bytes: &[u8]) -> String {
    match unpack(bytes) {
        Ok(_) => panic!("unpack accepted a malformed archive"),
        Err(e) => e,
    }
}

#[test]
fn bundle_paths_are_validated_on_set() {
    let mut b = Bundle::from_files(BTreeMap::new()).unwrap();
    for bad in [
        "",
        "/etc/passwd",
        "../evil",
        "a/../b",
        "a\\b",
        "a//b",
        "./a",
        "a\nb",
    ] {
        assert!(b.set(bad, vec![]).is_err(), "accepted {bad:?}");
    }
    assert!(b.set("skills/ok/SKILL.md", vec![]).is_ok());
    let mut files = BTreeMap::new();
    files.insert("../x".to_string(), vec![]);
    assert!(Bundle::from_files(files).is_err());
}

#[test]
fn unpack_rejects_traversal_links_and_duplicates() {
    use tar::EntryType;
    let err = unpack_err(&raw_archive(&[("../evil.md", EntryType::Regular, b"x")]));
    assert!(err.contains("invalid bundle path"), "got: {err}");
    let err = unpack_err(&raw_archive(&[("./a.md", EntryType::Regular, b"x")]));
    assert!(err.contains("invalid bundle path"), "got: {err}");
    let err = unpack_err(&raw_archive(&[("link", EntryType::Symlink, b"")]));
    assert!(err.contains("unsupported type"), "got: {err}");
    let err = unpack_err(&raw_archive(&[
        ("a.md", EntryType::Regular, b"one"),
        ("a.md", EntryType::Regular, b"two"),
    ]));
    assert!(err.contains("duplicate entry"), "got: {err}");
    let ok = unpack(&raw_archive(&[
        ("dir/", EntryType::Directory, b""),
        ("dir/a.md", EntryType::Regular, b"fine"),
    ]))
    .unwrap();
    assert_eq!(ok.get("dir/a.md").unwrap(), b"fine");
}

#[test]
fn unpack_caps_the_entry_count() {
    use tar::EntryType;
    let names: Vec<String> = (0..=10_000).map(|i| format!("f{i}")).collect();
    let entries: Vec<(&str, EntryType, &[u8])> = names
        .iter()
        .map(|n| (n.as_str(), EntryType::Regular, &b""[..]))
        .collect();
    let err = unpack_err(&raw_archive(&entries));
    assert!(err.contains("MAX_ARCHIVE_ENTRIES"), "got: {err}");
}
