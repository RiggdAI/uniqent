//! CSP is only enforced in the real webview, so pin the policy and the webview's permissions here:
//! scripts are self-only (no inline/eval), network goes through the http plugin over IPC, and the
//! webview gets event listen + https fetch and nothing else (Rust owns files and dialogs).
use serde_json::Value;

#[test]
fn csp_is_strict_and_capabilities_are_minimal() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let conf: Value =
        serde_json::from_str(&std::fs::read_to_string(dir.join("tauri.conf.json")).unwrap())
            .unwrap();
    let csp = &conf["app"]["security"]["csp"];
    assert!(csp.is_object(), "csp must not be null");
    assert_eq!(csp["script-src"], "'self'");
    assert_eq!(csp["img-src"], "'self' data:");
    assert_eq!(csp["connect-src"], "ipc: http://ipc.localhost");
    for directive in ["frame-src", "base-uri", "form-action", "object-src"] {
        assert_eq!(csp[directive], "'none'", "{directive}");
    }

    let caps: Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("capabilities/default.json")).unwrap(),
    )
    .unwrap();
    let ids: Vec<String> = caps["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            p.as_str()
                .map(String::from)
                .unwrap_or_else(|| p["identifier"].as_str().unwrap().into())
        })
        .collect();
    assert_eq!(
        ids,
        [
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "http:default"
        ]
    );
    let http = caps["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["identifier"] == "http:default")
        .unwrap();
    assert_eq!(
        http["allow"],
        serde_json::json!([{ "url": "https://*" }, { "url": "https://*/*" }])
    );
}
