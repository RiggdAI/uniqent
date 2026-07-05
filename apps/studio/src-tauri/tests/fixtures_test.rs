use serde_json::Value;
use uniqent_studio::session::Session;

fn fixture(name: &str) -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/");
    let raw = std::fs::read_to_string(format!("{p}{name}")).expect("fixture readable");
    serde_json::from_str(&raw).expect("fixture is JSON")
}

#[test]
fn default_state_matches_fixture() {
    assert_eq!(Session::new().state(), fixture("state-default.json"));
}

#[test]
fn catalog_matches_fixture() {
    assert_eq!(Session::new().catalog(), fixture("catalog.json"));
}

#[test]
fn canonical_mutations_match_fixture() {
    let mut s = Session::new();
    s.set_meta(serde_json::json!({
        "name": "fixture-brain",
        "description": "A fixture brain for cross-impl tests",
        "version": "1.2.3"
    }));
    s.set_targets(vec!["claude-code".into(), "hermes".into()]);
    s.set_persona("# Persona\n\nYou are the fixture.".into());
    s.set_readme("# Readme\n\nFixture readme.".into());
    assert_eq!(s.state(), fixture("state-mutated.json"));
}

#[test]
fn avatar_roundtrip_and_size_limit() {
    let mut s = Session::new();
    // 1x1 png data url
    let ok = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    s.set_avatar(ok.to_string()).expect("small avatar accepted");
    assert!(s.state()["avatar"]
        .as_str()
        .unwrap()
        .starts_with("data:image/png;base64,"));
    s.remove_avatar();
    assert!(s.state().get("avatar").is_none() || s.state()["avatar"].is_null());

    let big = format!("data:image/png;base64,{}", "A".repeat(700 * 1024)); // > 512KB decoded
    let err = s.set_avatar(big).unwrap_err();
    assert!(err.contains("avatar too large (max 512KB)"));
}

#[test]
fn reset_returns_to_default() {
    let mut s = Session::new();
    s.set_persona("changed".into());
    s.reset();
    assert_eq!(s.state(), fixture("state-default.json"));
}

#[test]
fn cleared_state_matches_fixture() {
    let mut s = Session::new();
    s.set_meta(serde_json::json!({
        "name": "fixture-brain",
        "description": "A fixture brain for cross-impl tests",
        "version": "1.2.3"
    }));
    s.set_targets(vec!["claude-code".into(), "hermes".into()]);
    s.set_persona("# Persona\n\nYou are the fixture.".into());
    s.set_readme("# Readme\n\nFixture readme.".into());
    // empty-string persona keeps key present with identity: true; whitespace readme drops the key
    s.set_persona("".into());
    s.set_readme("  ".into());
    assert_eq!(s.state(), fixture("state-cleared.json"));
}
