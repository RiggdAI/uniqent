//! The webview may fetch any https URL (capabilities/default.json). Without scopeRedirects the
//! http plugin checks only the first URL, so an https page could 302 to http://127.0.0.1 or a
//! cloud metadata address and the response would land in the brain. Pin the redirect check.
use serde_json::Value;

#[test]
fn http_plugin_re_checks_the_scope_on_every_redirect() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json");
    let conf: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(
        conf["plugins"]["http"]["scopeRedirects"],
        Value::Bool(true),
        "tauri.conf.json must set plugins.http.scopeRedirects = true"
    );
}
