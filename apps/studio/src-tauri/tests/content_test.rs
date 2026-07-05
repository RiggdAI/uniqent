use serde_json::{json, Value};
use uniqent_studio::session::Session;

fn fixture(name: &str) -> Value {
    let p = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/");
    let raw = std::fs::read_to_string(format!("{p}{name}")).expect("fixture readable");
    serde_json::from_str(&raw).expect("fixture is JSON")
}

fn apply_meta(s: &mut Session) {
    s.set_meta(json!({"name":"fixture-brain","description":"A fixture brain for cross-impl tests","version":"1.2.3"}));
    s.set_targets(vec!["claude-code".into(), "hermes".into()]);
    s.set_persona("# Persona\n\nYou are the fixture.".into());
    s.set_readme("# Readme\n\nFixture readme.".into());
}

fn apply_content(s: &mut Session) {
    s.add_mcp_catalog("github").unwrap();
    s.add_custom_mcp(json!({"id":"custom-api","name":"Custom API","transport":"streamable-http","url":"https://api.example.com/mcp","auth":{"type":"none"}})).unwrap();
    s.add_custom_skill("fixture-skill", "# fixture-skill\n\nDoes fixture things.\n");
    s.add_channel_catalog("telegram").unwrap();
    s.add_task(json!({"name":"Nightly digest","cron":"0 9 * * *","prompt":"Summarize."})).unwrap();
    s.add_fact(json!({"text":"Fixture prefers [[Rust]] #perf","importance":0.8})).unwrap();
    s.add_fact(json!({"text":"plain fact"})).unwrap();
    s.set_profile(json!({"name":"Fixture User","role":"Tester"}));
    s.remove_mcp("custom-api");
    s.add_custom_mcp(json!({"id":"custom-api","name":"Custom API","transport":"streamable-http","url":"https://api.example.com/mcp","auth":{"type":"none"}})).unwrap();
}

#[test]
fn content_state_matches_fixture() {
    let mut s = Session::new();
    apply_meta(&mut s);
    apply_content(&mut s);
    assert_eq!(s.state(), fixture("state-content.json"));
}

#[test]
fn unknown_mcp_catalog_id_errors() {
    let mut s = Session::new();
    assert!(s.add_mcp_catalog("nonexistent").is_err());
}

#[test]
fn remove_skill_clears_it() {
    let mut s = Session::new();
    s.add_custom_skill("my-skill", "# test");
    s.remove_skill("my-skill");
    let state = s.state();
    let skills = state["manifest"]["components"]["skills"].as_array().unwrap();
    assert!(skills.is_empty());
}

#[test]
fn readd_mcp_deduplicates() {
    let mut s = Session::new();
    s.add_mcp_catalog("github").unwrap();
    s.add_mcp_catalog("github").unwrap(); // re-add same id
    let state = s.state();
    let mcp = state["manifest"]["components"]["mcp"].as_array().unwrap();
    assert_eq!(mcp.len(), 1);
}
