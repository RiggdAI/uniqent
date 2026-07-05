use serde_json::{json, Value};
use uniqent_studio::ports::mcp_normalize::normalize_mcp_config;
use uniqent_studio::session::Session;

#[test]
fn normalize_mcp_config_fixture_cases() {
    let fixture_path =
        concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/ports/normalize-cases.json");
    let raw = std::fs::read_to_string(fixture_path).expect("normalize-cases.json readable");
    let cases: Vec<Value> = serde_json::from_str(&raw).expect("valid JSON");

    for case in &cases {
        let name = case["name"].as_str().unwrap_or("unknown");
        let input = &case["input"];
        let expected = &case["expected"];
        let actual = normalize_mcp_config(input);
        assert_eq!(actual, *expected, "case: {name}");
    }
}

#[test]
fn paste_mcp_preview_returns_normalized_no_mutation() {
    let s = Session::new();
    let blob = r#"{"mcpServers":{"brave":{"command":"npx","args":["-y","brave"],"env":{"BRAVE_API_KEY":"sk-abcdefghijklmnopqrstuvwxyz0123"}}}}"#;
    let preview = s.paste_mcp_preview(blob);
    assert_eq!(preview["servers"].as_array().unwrap().len(), 1);
    assert_eq!(preview["servers"][0]["id"], "brave");
    // No mutation: session has no mcp
    let state = s.state();
    let mcp_ids = state["manifest"]["components"]["mcp"].as_array().unwrap();
    assert!(!mcp_ids.iter().any(|v| v.as_str() == Some("brave")));
}

#[test]
fn paste_mcp_preview_bad_json_no_throw() {
    let s = Session::new();
    let preview = s.paste_mcp_preview("not json {");
    assert_eq!(preview["servers"].as_array().unwrap().len(), 0);
    assert!(!preview["lossiness"].as_array().unwrap().is_empty());
}

#[test]
fn add_pasted_mcp_mutates_session() {
    let mut s = Session::new();
    let blob = r#"{"mcpServers":{"brave":{"command":"npx","args":["-y","brave"],"env":{"BRAVE_API_KEY":"sk-abcdefghijklmnopqrstuvwxyz0123"}}}}"#;
    let count = s.add_pasted_mcp(blob).unwrap();
    assert_eq!(count, 1);
    let state = s.state();
    let mcp_ids = state["manifest"]["components"]["mcp"].as_array().unwrap();
    assert!(mcp_ids.iter().any(|v| v.as_str() == Some("brave")));
}

#[test]
fn import_mcp_servers_counts_added() {
    let mut s = Session::new();
    let servers = json!([
        {"command": "npx", "args": ["-y", "server1"]},
        {"command": "python", "args": ["-m", "server2"]}
    ]);
    let count = s.import_mcp_servers(servers).unwrap();
    assert_eq!(count, 2);
}
