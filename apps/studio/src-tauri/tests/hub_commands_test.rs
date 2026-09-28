use serde_json::json;
use uniqent_studio::credentials::token_from_store;
use uniqent_studio::session::Session;

#[test]
fn hub_mcp_result_adds_server_and_every_credential() {
    let mut s = Session::new();
    s.add_mcp_hub_result(
        json!({"id":"linear","transport":"streamable-http","url":"https://mcp.linear.app/mcp",
               "auth":{"type":"bearer","credentialRef":"linear_token"},"tools":{"include":"all"}}),
        vec![
            json!({"ref":"linear_token","label":"Linear token","type":"bearer",
                    "consumedBy":["mcp:linear"],"required":true}),
        ],
    )
    .unwrap();
    let st = s.state();
    assert_eq!(st["manifest"]["components"]["mcp"], json!(["linear"]));
    assert_eq!(
        st["manifest"]["credentials"][0]["ref"],
        json!("linear_token")
    );
    assert_eq!(
        st["manifest"]["credentials"][0]["label"],
        json!("Linear token")
    );
}

#[test]
fn hub_mcp_result_rejects_a_malformed_credential_and_changes_nothing() {
    let mut s = Session::new();
    let err = s
        .add_mcp_hub_result(
            json!({"id":"x","transport":"stdio","command":"x","auth":{"type":"none"},"tools":{"include":"all"}}),
            vec![json!({"ref":"Not A Slug","type":"apiKey"})],
        )
        .unwrap_err();
    assert!(err.contains("credentials[0]"), "{err}");
    assert_eq!(s.state()["manifest"]["components"]["mcp"], json!([]));
}

#[test]
fn hub_indexes_keep_only_unique_https_urls() {
    let mut s = Session::new();
    let err = s
        .set_hub_indexes(vec!["http://insecure.example/index.json".into()])
        .unwrap_err();
    assert!(err.contains("https"), "{err}");
    let kept = s
        .set_hub_indexes(vec![
            " https://a.example/i.json ".into(),
            "https://a.example/i.json".into(),
        ])
        .unwrap();
    assert_eq!(kept, vec!["https://a.example/i.json".to_string()]);
    assert_eq!(s.hub_indexes(), kept);
}

#[test]
fn imported_memory_keeps_its_source() {
    let mut s = Session::new();
    s.import_memory(
        json!({"items":[{"text":"Met Alice","kind":"episodic","source":"journal/2026-01-01.md"}]}),
    )
    .unwrap();
    assert_eq!(
        s.memory_items()[0]["source"],
        json!("journal/2026-01-01.md")
    );
    let err = s
        .import_memory(json!({"items":[{"text":"x","source":42}]}))
        .unwrap_err();
    assert!(err.contains("items[0].source"), "{err}");
}

#[test]
fn publish_payload_sends_only_shareable_facts() {
    let mut s = Session::new();
    s.import_memory(json!({"items":[{"text":"Team uses Postgres"},{"text":"My salary is X","visibility":"personal"}]}))
        .unwrap();
    let p = s.publish_payload().unwrap();
    assert_eq!(
        p["facts"],
        json!([{"kind":"fact","text":"Team uses Postgres"}])
    );
    assert_eq!(p["slug"], s.state()["manifest"]["name"]);
    assert_eq!(p["name"], s.state()["manifest"]["displayName"]);
}

#[test]
fn publish_payload_refuses_all_personal_memory() {
    let mut s = Session::new();
    s.import_memory(json!({"items":[{"text":"private","visibility":"personal"}]}))
        .unwrap();
    assert!(s
        .publish_payload()
        .unwrap_err()
        .contains("no shareable memory"));
}

#[test]
fn registry_token_reads_the_cli_store_and_fails_loudly_on_corruption() {
    let store = r#"{"https://uniqent.ai":{"token":"tok123"}}"#;
    assert_eq!(
        token_from_store(store, "https://uniqent.ai/").unwrap(),
        Some("tok123".into())
    );
    assert_eq!(
        token_from_store(store, "https://other.example").unwrap(),
        None
    );
    let err = token_from_store("{not json", "https://uniqent.ai").unwrap_err();
    assert!(err.contains("credentials.json"), "{err}");
}
