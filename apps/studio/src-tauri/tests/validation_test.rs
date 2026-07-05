use uniqent_studio::session::{validate_manifest, Session};

// ---------------------------------------------------------------------------
// validate_manifest: name validation
// ---------------------------------------------------------------------------

#[test]
fn invalid_name_my_brain_returns_ok_false_with_name_error() {
    // "My Brain" has uppercase and a space — not a valid slug
    let v = validate_manifest("My Brain", "1.0.0");
    assert_eq!(v["ok"], false, "expected ok=false for invalid slug name");
    let errors = v["errors"].as_array().expect("errors is array");
    assert!(!errors.is_empty(), "expected at least one error");
    let has_name_error = errors.iter().any(|e| {
        e["code"] == "manifest"
            && e["path"] == "uniqent.json"
            && e["message"]
                .as_str()
                .map(|m| m.contains("name"))
                .unwrap_or(false)
    });
    assert!(has_name_error, "expected a name error, got: {errors:?}");
}

#[test]
fn invalid_name_with_uppercase_fails() {
    let v = validate_manifest("MyBrain", "1.0.0");
    assert_eq!(v["ok"], false);
    let errors = v["errors"].as_array().unwrap();
    assert!(errors.iter().any(|e| e["code"] == "manifest" && e["path"] == "uniqent.json"));
}

#[test]
fn invalid_name_starting_with_hyphen_fails() {
    let v = validate_manifest("-bad", "1.0.0");
    assert_eq!(v["ok"], false);
}

#[test]
fn valid_slug_names_pass() {
    for name in &["my-brain", "brain123", "a", "core-fixture", "my-brain-v2"] {
        let v = validate_manifest(name, "1.0.0");
        assert_eq!(
            v["ok"],
            true,
            "expected ok=true for valid slug '{name}', got: {v}"
        );
    }
}

// ---------------------------------------------------------------------------
// validate_manifest: version validation
// ---------------------------------------------------------------------------

#[test]
fn invalid_version_abc_returns_ok_false_with_version_error() {
    let v = validate_manifest("my-brain", "abc");
    assert_eq!(v["ok"], false, "expected ok=false for invalid version 'abc'");
    let errors = v["errors"].as_array().expect("errors is array");
    assert!(!errors.is_empty(), "expected at least one error");
    let has_version_error = errors.iter().any(|e| {
        e["code"] == "manifest"
            && e["path"] == "uniqent.json"
            && e["message"]
                .as_str()
                .map(|m| m.contains("version"))
                .unwrap_or(false)
    });
    assert!(has_version_error, "expected a version error, got: {errors:?}");
}

#[test]
fn invalid_version_with_leading_v_fails() {
    let v = validate_manifest("my-brain", "v1.0.0");
    assert_eq!(v["ok"], false, "v1.0.0 is not valid semver");
}

#[test]
fn valid_semver_versions_pass() {
    for ver in &["0.1.0", "1.2.3", "10.20.30", "1.0.0-alpha.1", "1.0.0+build.1"] {
        let v = validate_manifest("my-brain", ver);
        assert_eq!(
            v["ok"],
            true,
            "expected ok=true for valid semver '{ver}', got: {v}"
        );
    }
}

// ---------------------------------------------------------------------------
// validate_manifest: both invalid
// ---------------------------------------------------------------------------

#[test]
fn both_invalid_name_and_version_produce_two_errors() {
    let v = validate_manifest("My Brain", "abc");
    assert_eq!(v["ok"], false);
    let errors = v["errors"].as_array().unwrap();
    assert_eq!(errors.len(), 2, "expected two errors, got: {errors:?}");
}

// ---------------------------------------------------------------------------
// Session::state: default session validates ok
// ---------------------------------------------------------------------------

#[test]
fn default_session_state_validation_ok_true() {
    // Session::new() uses name="my-brain" and version="0.1.0" — both valid
    let s = Session::new();
    let state = s.state();
    assert_eq!(
        state["validation"]["ok"],
        true,
        "default session must have ok=true, got: {}",
        state["validation"]
    );
    let errors = state["validation"]["errors"].as_array().unwrap();
    assert!(errors.is_empty(), "default session must have no errors, got: {errors:?}");
}
