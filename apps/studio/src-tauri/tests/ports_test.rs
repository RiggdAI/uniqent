use serde_json::{json, Value};
use uniqent_studio::ports::mcp_normalize::normalize_mcp_config;
use uniqent_studio::ports::memory::{memory_graph, parse_memory_markdown};
use uniqent_studio::session::Session;

#[test]
fn normalize_mcp_config_fixture_cases() {
    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/ports/normalize-cases.json"
    );
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

// ─── Memory port fixture tests ────────────────────────────────────────────────

#[test]
fn memory_fixture_cases() {
    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/ports/memory-cases.json"
    );
    let raw = std::fs::read_to_string(fixture_path).expect("memory-cases.json readable");
    let cases: Vec<Value> = serde_json::from_str(&raw).expect("valid JSON");

    for case in &cases {
        let name = case["name"].as_str().unwrap_or("unknown");
        let markdown = case["markdown"].as_str().unwrap_or("");
        let expected_parsed = &case["parsed"];
        let expected_graph = &case["graph"];

        let actual_parsed = parse_memory_markdown(markdown);
        assert_eq!(actual_parsed, *expected_parsed, "case: {name} (parsed)");

        // Build graph input same way as fixture emitter: map with id=m{i}
        let items: Vec<Value> = actual_parsed
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
            .map(|(i, it)| {
                json!({
                    "id": format!("m{i}"),
                    "text": it["text"],
                    "kind": it["kind"]
                })
            })
            .collect();
        let actual_graph = memory_graph(&Value::Array(items));
        assert_eq!(actual_graph, *expected_graph, "case: {name} (graph)");
    }
}

// ─── Session memory method tests ──────────────────────────────────────────────

#[test]
fn import_memory_markdown_returns_count() {
    let mut s = Session::new();
    let payload = json!({"markdown": "- Decision: use [[Postgres]] #db\n- plain fact"});
    let count = s.import_memory(payload).unwrap();
    assert_eq!(count, 2);
}

#[test]
fn import_memory_text_lines_returns_count() {
    let mut s = Session::new();
    let payload = json!({"text": "first line\nsecond line\n\nthird line"});
    let count = s.import_memory(payload).unwrap();
    assert_eq!(count, 3);
}

#[test]
fn import_memory_items_returns_count() {
    let mut s = Session::new();
    let payload = json!({
        "items": [
            {"text": "item one", "kind": "fact"},
            {"text": "item two", "kind": "decision"}
        ]
    });
    let count = s.import_memory(payload).unwrap();
    assert_eq!(count, 2);
}

#[test]
fn import_memory_items_skips_blank_text() {
    let mut s = Session::new();
    let payload = json!({
        "items": [
            {"text": "valid item"},
            {"text": ""},
            {"text": "   "}
        ]
    });
    let count = s.import_memory(payload).unwrap();
    assert_eq!(count, 1);
}

#[test]
fn preview_memory_returns_items_and_graph() {
    let s = Session::new();
    let result = s.preview_memory("- Decision: use [[Postgres]] #db\n- plain fact");
    let items = result["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["kind"], "decision");
    assert_eq!(items[1]["kind"], "fact");
    let nodes = result["graph"]["nodes"].as_array().unwrap();
    // Should have: mem:p0, mem:p1, ent:postgres, tag:db
    assert!(nodes.iter().any(|n| n["id"] == "mem:p0"));
    assert!(nodes.iter().any(|n| n["id"] == "ent:postgres"));
    assert!(nodes.iter().any(|n| n["id"] == "tag:db"));
}

#[test]
fn preview_memory_does_not_mutate_session() {
    let s = Session::new();
    s.preview_memory("a fact");
    let state = s.state();
    assert_eq!(state["manifest"]["components"]["memory"]["facts"], 0);
}

#[test]
fn session_memory_graph_from_imported_facts() {
    let mut s = Session::new();
    s.import_memory(json!({"markdown": "chose [[Postgres]] #db\n[[Postgres]] tuning #db #perf"}))
        .unwrap();
    let graph = s.memory_graph();
    let nodes = graph["nodes"].as_array().unwrap();
    // Postgres entity clusters both items
    let pg = nodes.iter().find(|n| n["id"] == "ent:postgres").unwrap();
    assert_eq!(pg["degree"], 2);
    // tag:db should connect both items
    let db = nodes.iter().find(|n| n["id"] == "tag:db").unwrap();
    assert_eq!(db["degree"], 2);
}

#[test]
fn secret_scan_fixture_cases() {
    use base64::Engine;
    use std::collections::BTreeMap;
    use uniqent_studio::core::bundle::Bundle;
    use uniqent_studio::core::secret_scan::{is_likely_secret_value, scan_for_secrets};

    let fixture_path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../fixtures/ports/secret-cases.json"
    );
    let raw = std::fs::read_to_string(fixture_path).expect("secret-cases.json readable");
    let cases: Value = serde_json::from_str(&raw).expect("valid JSON");

    for case in cases["values"].as_array().unwrap() {
        let value = case["value"].as_str().unwrap();
        let likely = case["likely"].as_bool().unwrap();
        assert_eq!(is_likely_secret_value(value), likely, "value: {value:?}");
    }

    for case in cases["bundles"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut files = BTreeMap::new();
        for (path, f) in case["files"].as_object().unwrap() {
            let bytes = match (f.get("text"), f.get("base64")) {
                (Some(t), _) => t.as_str().unwrap().as_bytes().to_vec(),
                (_, Some(b)) => base64::engine::general_purpose::STANDARD
                    .decode(b.as_str().unwrap())
                    .unwrap(),
                _ => panic!("case {name}: file {path} has neither text nor base64"),
            };
            files.insert(path.clone(), bytes);
        }
        let bundle = Bundle::from_files(files).unwrap();
        let actual: Vec<(String, String)> = scan_for_secrets(&bundle)
            .into_iter()
            .map(|f| (f.path, f.hint))
            .collect();
        let expected: Vec<(String, String)> = case["findings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| {
                (
                    f["path"].as_str().unwrap().to_string(),
                    format!(
                        "{}: {}",
                        f["kind"].as_str().unwrap(),
                        f["snippet"].as_str().unwrap()
                    ),
                )
            })
            .collect();
        assert_eq!(actual, expected, "bundle case: {name}");
    }
}

#[test]
fn import_mcp_servers_batches_raw_servers_and_rejects_duplicate_ids() {
    let mut s = Session::new();
    let n = s
        .import_mcp_servers(
            json!([{"command": "node", "args": ["a.js"]}, {"command": "node", "args": ["b.js"]}]),
        )
        .unwrap();
    assert_eq!(n, 2);
    assert_eq!(
        s.state()["manifest"]["components"]["mcp"],
        json!(["mcp-server", "mcp-server-2"])
    );

    let mut s = Session::new();
    let server =
        json!({"id": "dup", "transport": "stdio", "command": "x", "auth": {"type": "none"}});
    let err = s.import_mcp_servers(json!([server, server])).unwrap_err();
    assert!(err.contains("share the id \"dup\""), "got: {err}");
    assert_eq!(s.state()["manifest"]["components"]["mcp"], json!([]));
}
