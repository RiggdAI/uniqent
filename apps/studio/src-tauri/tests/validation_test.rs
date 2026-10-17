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
    assert!(errors
        .iter()
        .any(|e| e["code"] == "manifest" && e["path"] == "uniqent.json"));
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
            v["ok"], true,
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
    assert_eq!(
        v["ok"], false,
        "expected ok=false for invalid version 'abc'"
    );
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
    assert!(
        has_version_error,
        "expected a version error, got: {errors:?}"
    );
}

#[test]
fn invalid_version_with_leading_v_fails() {
    let v = validate_manifest("my-brain", "v1.0.0");
    assert_eq!(v["ok"], false, "v1.0.0 is not valid semver");
}

#[test]
fn valid_semver_versions_pass() {
    for ver in &[
        "0.1.0",
        "1.2.3",
        "10.20.30",
        "1.0.0-alpha.1",
        "1.0.0+build.1",
    ] {
        let v = validate_manifest("my-brain", ver);
        assert_eq!(
            v["ok"], true,
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
        state["validation"]["ok"], true,
        "default session must have ok=true, got: {}",
        state["validation"]
    );
    let errors = state["validation"]["errors"].as_array().unwrap();
    assert!(
        errors.is_empty(),
        "default session must have no errors, got: {errors:?}"
    );
}

// ---------------------------------------------------------------------------
// Session input validation (parity with the TS Studio API)
// ---------------------------------------------------------------------------

#[test]
fn set_meta_rejects_invalid_values_without_changing_anything() {
    let mut s = Session::new();
    let err = s
        .set_meta(serde_json::json!({"name": "My Brain", "version": "1.0.0"}))
        .unwrap_err();
    assert!(err.contains("\"name\""), "got: {err}");
    assert!(s
        .set_meta(serde_json::json!({"name": "ok-name", "version": "v1"}))
        .is_err());
    let state = s.state();
    assert_eq!(state["manifest"]["name"], "my-brain");
    assert_eq!(state["manifest"]["version"], "0.1.0");
    assert_eq!(state["validation"]["ok"], true);
    s.set_meta(serde_json::json!({"name": "renamed", "displayName": "Renamed"}))
        .unwrap();
    assert_eq!(s.state()["manifest"]["displayName"], "Renamed");
}

#[test]
fn memory_importance_must_be_between_0_and_1() {
    let mut s = Session::new();
    let err = s
        .add_fact(serde_json::json!({"text": "x", "importance": 5}))
        .unwrap_err();
    assert!(err.contains("between 0 and 1"), "got: {err}");
    assert!(s
        .import_memory(
            serde_json::json!({"items": [{"text": "ok"}, {"text": "y", "importance": -1}]})
        )
        .is_err());
    assert!(s
        .import_memory(serde_json::json!({"items": [null]}))
        .is_err());
    assert!(s
        .import_memory(serde_json::json!({"items": [{"text": "z", "kind": "gossip"}]}))
        .is_err());
    // Nothing was added by the rejected batches.
    assert_eq!(s.state()["manifest"]["components"]["memory"]["facts"], 0);
    s.add_fact(serde_json::json!({"text": "x", "importance": 1}))
        .unwrap();
    assert_eq!(s.state()["manifest"]["components"]["memory"]["facts"], 1);
}

#[test]
fn skill_names_must_be_slugs_and_unique() {
    let mut s = Session::new();
    for bad in ["My Skill!", "..", "", "-x"] {
        assert!(s.add_custom_skill(bad, "# x").is_err(), "accepted {bad:?}");
    }
    s.add_custom_skill("notes", "# one").unwrap();
    let err = s.add_custom_skill("notes", "# two").unwrap_err();
    assert!(err.contains("already in this brain"), "got: {err}");
}

#[test]
fn tasks_validate_cron_and_trigger_type() {
    let mut s = Session::new();
    for cron in [
        "every day at nine",
        "0 25 * * *",
        "* * * *",
        "*/0 * * * *",
        "5-1 * * * *",
    ] {
        let err = s
            .add_task(serde_json::json!({"triggerType": "schedule", "cron": cron}))
            .unwrap_err();
        assert!(err.starts_with("invalid cron"), "cron {cron:?}: {err}");
    }
    assert!(s
        .add_task(serde_json::json!({"triggerType": "sometimes"}))
        .is_err());
    assert!(s
        .add_task(serde_json::json!({"triggerType": "event", "event": " "}))
        .is_err());
    assert_eq!(
        s.state()["manifest"]["components"]["tasks"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    s.add_task(
        serde_json::json!({"name": "", "triggerType": "schedule", "cron": "*/15 9-17 * * 1-5"}),
    )
    .unwrap();
    s.add_task(serde_json::json!({"triggerType": "manual", "cron": "0 9 * * *"}))
        .unwrap();
    assert_eq!(
        s.state()["manifest"]["components"]["tasks"],
        serde_json::json!(["task-1", "task-2"])
    );
}

#[test]
fn cron_problem_matches_the_ts_rules() {
    use uniqent_studio::session::cron_problem;
    assert_eq!(cron_problem("0 9 * * *"), None);
    assert_eq!(cron_problem("0,30 */2 1-15 1,6,12 0-7"), None);
    assert!(cron_problem("every day at nine").is_some());
    assert!(cron_problem("60 * * * *").is_some());
}

#[test]
fn profile_must_be_an_object_of_text() {
    let mut s = Session::new();
    assert!(s.set_profile(serde_json::json!("abc")).is_err());
    let err = s
        .set_profile(serde_json::json!({"keys": {"token": "SECRET_VAL"}}))
        .unwrap_err();
    assert!(
        err.contains("\"keys\"") && err.contains("an object") && !err.contains("SECRET_VAL"),
        "{err}"
    );
    let err = s
        .set_profile(serde_json::json!(["SECRET_VAL"]))
        .unwrap_err();
    assert!(
        err.contains("an array") && !err.contains("SECRET_VAL"),
        "{err}"
    );
    assert!(s
        .set_profile(serde_json::json!({"Role": "a", " Role ": "b"}))
        .is_err());
    s.set_profile(serde_json::json!({"Role": "Engineer"}))
        .unwrap();
    assert_eq!(s.get_profile(), serde_json::json!({"Role": "Engineer"}));
}

#[test]
fn profile_trims_names_and_values_and_drops_blank_ones() {
    let mut s = Session::new();
    s.set_profile(serde_json::json!({" Name ": " Ada ", "nick": "   ", "  ": "x"}))
        .unwrap();
    assert_eq!(s.get_profile(), serde_json::json!({"Name": "Ada"}));
    s.set_profile(serde_json::json!({"nick": " \t "})).unwrap();
    assert_eq!(s.get_profile(), serde_json::json!({}));
}

#[test]
fn custom_mcp_must_be_a_spec_server() {
    let mut s = Session::new();
    let cases = [
        (
            serde_json::json!({"id": "bad", "transport": "streamable-http", "auth": {"type": "none"}}),
            "url",
        ),
        (
            serde_json::json!({"id": "bad", "transport": "sse", "url": "", "auth": {"type": "none"}}),
            "url",
        ),
        (
            serde_json::json!({"id": "bad", "transport": "stdio", "command": "", "auth": {"type": "none"}}),
            "command",
        ),
        (
            serde_json::json!({"id": "bad", "transport": "ws", "url": "https://x.example/mcp", "auth": {"type": "none"}}),
            "transport",
        ),
        (
            serde_json::json!({"id": "bad", "transport": "streamable-http", "url": "https://x.example/mcp",
                "auth": {"type": "header", "credentialRef": "k"}}),
            "headerName",
        ),
    ];
    for (server, field) in cases {
        let err = s.add_custom_mcp(server).unwrap_err();
        assert!(err.contains(field), "{err}");
    }
    let m = &s.state()["manifest"];
    assert!(
        m["components"]["mcp"].as_array().is_none_or(Vec::is_empty),
        "{m}"
    );
    assert!(m["credentials"].as_array().is_none_or(Vec::is_empty), "{m}");

    s.add_custom_mcp(
        serde_json::json!({"id": "ok", "transport": "stdio", "command": "npx",
        "auth": {"type": "none"}}),
    )
    .unwrap();
    assert_eq!(
        s.state()["manifest"]["components"]["mcp"],
        serde_json::json!(["ok"])
    );
}

#[test]
fn facts_carry_a_real_created_at() {
    use base64::Engine;
    let mut s = Session::new();
    s.add_fact(serde_json::json!({"text": "remember me"}))
        .unwrap();
    s.import_memory(serde_json::json!({"text": "line one"}))
        .unwrap();
    let out = s.export(false).unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(out["bytesBase64"].as_str().unwrap())
        .unwrap();
    let b = uniqent_studio::core::archive::unpack(&bytes).unwrap();
    let facts = String::from_utf8(b.get("memory/facts.jsonl").unwrap().clone()).unwrap();
    let ts = regex::Regex::new(r"^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$").unwrap();
    for line in facts.lines() {
        let fact: serde_json::Value = serde_json::from_str(line).unwrap();
        let created = fact["createdAt"].as_str().unwrap();
        assert!(
            ts.is_match(created),
            "createdAt {created:?} is not a current ISO timestamp"
        );
    }
}

#[test]
fn generated_fact_ids_skip_imported_ones() {
    let mut s = Session::new();
    s.import_memory(serde_json::json!({"items": [{"id": "fact-1", "text": "imported"}]}))
        .unwrap();
    s.add_fact(serde_json::json!({"text": "typed"})).unwrap();
    assert!(s
        .import_memory(serde_json::json!({"items": [{"id": "fact-1", "text": "again"}]}))
        .unwrap_err()
        .contains("duplicate memory id"));
    let ids: Vec<String> = s.memory_graph()["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|n| n["id"].as_str().map(String::from))
        .collect();
    assert!(
        ids.contains(&"mem:fact-1".to_string()) && ids.contains(&"mem:fact-2".to_string()),
        "{ids:?}"
    );
}
