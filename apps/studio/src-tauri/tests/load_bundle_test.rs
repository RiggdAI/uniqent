use base64::Engine;
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::Mutex;
use uniqent_studio::commands::{load_files_into, AppState};
use uniqent_studio::core::bundle::Bundle;
use uniqent_studio::session::{open_bundle_bytes, BundleFile, Session};

#[test]
fn opens_the_signed_golden_fixture_and_refuses_a_tampered_copy() {
    let p = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/core/fixture-signed.uniqent"
    );
    let bytes = std::fs::read(p).unwrap();
    let (bundle, sig) = open_bundle_bytes(&bytes).unwrap();
    assert_eq!(sig, "valid");
    let mut tampered = bundle.clone();
    tampered
        .set("identity/persona.md", b"changed".to_vec())
        .unwrap();
    let packed = uniqent_studio::core::archive::pack(&tampered).unwrap();
    // `.err()`: Bundle and Session are not Debug (a session holds its private key).
    let err = open_bundle_bytes(&packed)
        .err()
        .expect("tampered copy refused");
    assert!(err.contains("INVALID"), "{err}");
}

#[test]
fn capture_round_trip_loads_every_captured_component() {
    for target in ["claude-code", "hermes", "openclaw"] {
        let bundle = captured_bundle(target);
        let (s, dropped) = Session::load_bundle(&bundle).unwrap();
        let m = &s.state()["manifest"];
        assert_eq!(
            m["components"]["skills"],
            bundle_manifest(&bundle)["components"]["skills"],
            "{target}"
        );
        assert_eq!(
            m["components"]["mcp"],
            bundle_manifest(&bundle)["components"]["mcp"],
            "{target}"
        );
        assert_eq!(
            m["credentials"].as_array().unwrap().len(),
            bundle_manifest(&bundle)["credentials"]
                .as_array()
                .unwrap()
                .len(),
            "{target}"
        );
        // Re-exported content equals the captured content for everything the session holds.
        let out: BTreeMap<_, _> = s
            .bundle_files()
            .unwrap()
            .into_iter()
            .map(|f| (f.path, f.bytes_base64))
            .collect();
        for path in [
            "identity/persona.md",
            "identity/policies.md",
            "memory/profile.json",
        ] {
            if let Some(b) = bundle.get(path) {
                assert_eq!(out.get(path), Some(&b64(b)), "{target} {path}");
            }
        }
        assert!(
            dropped.iter().all(|d| !d.contains("persona")),
            "{target}: {dropped:?}"
        );
    }
}

#[test]
fn reports_what_the_session_cannot_hold() {
    let (_, dropped) = Session::load_bundle(&rich_bundle()).unwrap();
    for needle in ["episodic", "tools", "runtime"] {
        assert!(
            dropped.iter().any(|d| d.contains(needle)),
            "{needle} not reported: {dropped:?}"
        );
    }
}

#[test]
fn a_malformed_component_names_its_file_and_changes_nothing() {
    let state = app_state();
    state.session.lock().unwrap().set_persona("# Keep".into());
    let files: Vec<BundleFile> =
        bundle_with("mcp/servers.json", r#"{"servers":[{"id":"Bad Id"}]}"#)
            .entries()
            .map(|(path, bytes)| BundleFile {
                path: path.clone(),
                bytes_base64: b64(bytes),
            })
            .collect();
    let err = load_files_into(&state, files).unwrap_err();
    assert!(err.contains("mcp/servers.json"), "{err}");
    let kept = state.session.lock().unwrap().state();
    assert_eq!(kept["persona"], "# Keep");
    assert_eq!(kept["manifest"]["name"], "my-brain");
}

#[test]
fn opens_an_unsigned_bundle_and_says_so() {
    let unsigned = captured_bundle("hermes");
    let packed = uniqent_studio::core::archive::pack(&unsigned).unwrap();
    let (bundle, sig) = open_bundle_bytes(&packed).unwrap();
    assert_eq!(sig, "unsigned");
    let (s, dropped) = Session::load_bundle(&bundle).unwrap();
    assert_eq!(s.state()["manifest"]["name"], "captured-hermes-agent");
    assert!(
        dropped.iter().all(|d| !d.contains("signature")),
        "{dropped:?}"
    );
}

#[test]
fn reports_blank_readme_empty_profile_values_and_repeated_credential_refs() {
    let mut manifest: Value = serde_json::from_str(MANIFEST).unwrap();
    let cred = serde_json::json!({
        "ref": "api_key", "label": "API key", "type": "apiKey", "consumedBy": [], "required": true
    });
    manifest["credentials"] = serde_json::json!([cred, cred]);
    let manifest = serde_json::to_string_pretty(&manifest).unwrap();
    let (_, dropped) = Session::load_bundle(&bundle_from(&[
        ("uniqent.json", &manifest),
        ("README.md", "  \n"),
        (
            "memory/profile.json",
            r#"{"name":"Ada","nick":"","bio":"  "}"#,
        ),
    ]))
    .unwrap();
    for needle in ["README.md", "\"nick\"", "\"bio\"", "\"api_key\""] {
        assert!(
            dropped.iter().any(|d| d.contains(needle)),
            "{needle} not reported: {dropped:?}"
        );
    }
}

#[test]
fn opens_only_a_dropped_file() {
    use uniqent_studio::vault::granted_file;
    let d = tempfile::tempdir().unwrap();
    let root = d.path().canonicalize().unwrap();
    for name in ["dropped.uniqent", "other.uniqent"] {
        std::fs::write(root.join(name), b"x").unwrap();
    }
    let granted = vec![root.join("dropped.uniqent")];
    let path = |name: &str| root.join(name).to_string_lossy().into_owned();
    assert_eq!(
        granted_file(&granted, &path("dropped.uniqent")).unwrap(),
        root.join("dropped.uniqent")
    );
    let err = granted_file(&granted, &path("other.uniqent")).unwrap_err();
    assert!(err.contains("was not dropped"), "{err}");
}

#[cfg(unix)]
#[test]
fn a_drop_grants_canonical_folders_and_files_only() {
    use uniqent_studio::commands::{grant_dropped, DroppedPath};
    let d = tempfile::tempdir().unwrap();
    let root = d.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("vault")).unwrap();
    std::os::unix::fs::symlink(root.join("vault"), root.join("link")).unwrap();
    std::fs::write(root.join("a.uniqent"), b"x").unwrap();
    let state = app_state();
    let (granted, refused) = grant_dropped(
        &state,
        &[
            root.join("link"),
            root.join("a.uniqent"),
            root.join("missing"),
        ],
    );
    let at = |name: &str, kind| DroppedPath {
        path: root.join(name).to_string_lossy().into_owned(),
        kind,
    };
    assert_eq!(granted, vec![at("vault", "dir"), at("a.uniqent", "file")]);
    assert_eq!(
        *state.granted_dirs.lock().unwrap(),
        vec![root.join("vault")]
    );
    assert_eq!(
        *state.granted_files.lock().unwrap(),
        vec![root.join("a.uniqent")]
    );
    assert!(
        refused.len() == 1 && refused[0].contains("missing"),
        "{refused:?}"
    );
}

// ── helpers ────────────────────────────────────────────────────────────────

fn app_state() -> AppState {
    AppState {
        session: Mutex::new(Session::new()),
        granted_dirs: Mutex::new(vec![]),
        granted_files: Mutex::new(vec![]),
    }
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// The bundle `uniqent export` captured for `target` (fixtures/install/<target>.json "captured").
fn captured_bundle(target: &str) -> Bundle {
    let p = format!(
        "{}/../fixtures/install/{target}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let fx: Value = serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap();
    let files = fx["captured"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(path, v)| {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(v.as_str().unwrap())
                .unwrap();
            (path.clone(), bytes)
        })
        .collect();
    Bundle::from_files(files).unwrap()
}

fn bundle_manifest(bundle: &Bundle) -> Value {
    serde_json::from_slice(bundle.get("uniqent.json").unwrap()).unwrap()
}

const MANIFEST: &str = r#"{
  "specVersion": "0.1",
  "name": "rich-brain",
  "displayName": "Rich Brain",
  "version": "1.0.0",
  "description": "A brain with parts Studio does not model.",
  "author": { "name": "Anonymous" },
  "license": "CC0-1.0",
  "tags": [],
  "components": {
    "identity": true,
    "memory": { "facts": 1, "episodic": 1, "hasProfile": false },
    "skills": [], "mcp": [], "tools": ["web-search"], "tasks": [], "channels": []
  },
  "credentials": [],
  "permissions": {
    "filesystem": { "read": [], "write": [] },
    "network": { "endpoints": [] },
    "autonomy": "suggest",
    "spawnsProcesses": false
  },
  "compatibility": { "targets": ["hermes"] }
}"#;

fn bundle_from(files: &[(&str, &str)]) -> Bundle {
    Bundle::from_files(
        files
            .iter()
            .map(|(p, t)| (p.to_string(), t.as_bytes().to_vec()))
            .collect(),
    )
    .unwrap()
}

/// Episodic memory, a tools file and a runtime config: none of them has a place in the session.
fn rich_bundle() -> Bundle {
    bundle_from(&[
        ("uniqent.json", MANIFEST),
        ("identity/persona.md", "# Rich"),
        (
            "memory/facts.jsonl",
            "{\"id\":\"fact-3\",\"kind\":\"fact\",\"text\":\"Kept\",\"createdAt\":\"2026-01-01T00:00:00.000Z\"}\n",
        ),
        (
            "memory/episodic.jsonl",
            "{\"id\":\"e1\",\"kind\":\"episodic\",\"text\":\"Met Bob\",\"createdAt\":\"2026-01-01T00:00:00.000Z\"}\n",
        ),
        (
            "tools/tools.json",
            r#"{"tools":[{"id":"web-search","enabled":true}]}"#,
        ),
        ("setup/runtime.json", r#"{"autonomy":"auto"}"#),
    ])
}

/// A minimal valid bundle plus one more file.
fn bundle_with(path: &str, text: &str) -> Bundle {
    bundle_from(&[("uniqent.json", MANIFEST), (path, text)])
}
