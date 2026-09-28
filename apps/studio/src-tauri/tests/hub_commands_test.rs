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

fn stdio_with_env_secret() -> serde_json::Value {
    json!({"id":"srv","transport":"stdio","command":"npx","args":["-y","srv-mcp@1.0.0"],
           "env":{"SRV_API_KEY":"${credentialRef:srv_api_key}"},
           "auth":{"type":"none"},"tools":{"include":"all"}})
}

#[test]
fn hub_credentials_export_in_the_spec_shape_with_their_consumers() {
    let mut s = Session::new();
    // No `help` (MCP Registry env vars often have no description) and consumedBy declared.
    s.add_mcp_hub_result(
        stdio_with_env_secret(),
        vec![json!({"ref":"srv_api_key","label":"SRV_API_KEY","type":"envVar",
                    "consumedBy":["mcp:srv"],"required":true})],
    )
    .unwrap();
    let cred = &s.state()["manifest"]["credentials"][0];
    assert_eq!(cred["consumedBy"], json!(["mcp:srv"]));
    assert!(cred.get("help").is_none(), "absent help must stay absent, got {cred}");
    assert!(cred.get("oauth").is_none(), "absent oauth must stay absent, got {cred}");
}

#[test]
fn env_placeholders_count_as_consumers_like_the_ts_builder() {
    let mut s = Session::new();
    s.add_mcp_hub_result(
        stdio_with_env_secret(),
        vec![json!({"ref":"srv_api_key","label":"SRV_API_KEY","type":"envVar",
                    "consumedBy":[],"required":true})],
    )
    .unwrap();
    assert_eq!(
        s.state()["manifest"]["credentials"][0]["consumedBy"],
        json!(["mcp:srv"])
    );
}

#[test]
fn oauth_details_survive_into_the_manifest() {
    let mut s = Session::new();
    s.add_mcp_hub_result(
        json!({"id":"o","transport":"streamable-http","url":"https://o.example/mcp",
               "auth":{"type":"oauth2","credentialRef":"o_oauth"},"tools":{"include":"all"}}),
        vec![json!({"ref":"o_oauth","label":"O","type":"oauth2","consumedBy":["mcp:o"],
                    "required":true,"help":"Sign in at o.example",
                    "oauth":{"authorizationUrl":"https://o.example/auth"}})],
    )
    .unwrap();
    let cred = &s.state()["manifest"]["credentials"][0];
    assert_eq!(cred["help"], json!("Sign in at o.example"));
    assert_eq!(cred["oauth"], json!({"authorizationUrl":"https://o.example/auth"}));
}

#[test]
fn an_explicit_null_help_is_rejected_like_zod() {
    let mut s = Session::new();
    let err = s
        .add_mcp_hub_result(
            stdio_with_env_secret(),
            vec![json!({"ref":"srv_api_key","label":"L","type":"envVar",
                        "consumedBy":["mcp:srv"],"required":true,"help":null})],
        )
        .unwrap_err();
    assert!(err.contains("help"), "{err}");
}
