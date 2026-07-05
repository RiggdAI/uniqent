use std::path::Path;
use uniqent_studio::session::Session;

#[test]
fn export_produces_verifiable_signed_bundle() {
    let mut s = Session::new();
    s.set_meta(serde_json::json!({"name": "export-test", "description": "d", "version": "0.0.1"}));
    s.set_persona("# P".into());
    let out = s.export(true).expect("export ok");
    assert_eq!(out["filename"], "export-test.uniqent");
    assert_eq!(out["signed"], true);
    assert_eq!(out["verified"], true);
    assert!(out["validation"]["ok"].is_boolean());
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(out["bytesBase64"].as_str().unwrap())
        .expect("valid base64");
    let b = uniqent_studio::core::archive::unpack(&bytes).expect("self-unpacks");
    assert!(uniqent_studio::core::signing::verify(&b).valid);
}

#[test]
fn export_unsigned_does_not_verify() {
    let mut s = Session::new();
    s.set_meta(serde_json::json!({"name": "unsigned-test", "description": "d", "version": "0.0.1"}));
    let out = s.export(false).expect("export ok");
    assert_eq!(out["filename"], "unsigned-test.uniqent");
    assert_eq!(out["signed"], false);
    assert_eq!(out["verified"], false);
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(out["bytesBase64"].as_str().unwrap())
        .expect("valid base64");
    let b = uniqent_studio::core::archive::unpack(&bytes).expect("self-unpacks");
    assert!(!uniqent_studio::core::signing::verify(&b).valid);
}

#[test]
#[ignore]
fn write_exchange_artifact() {
    let mut s = Session::new();
    s.set_meta(serde_json::json!({
        "name": "exchange-brain",
        "description": "Cross-language exchange test brain",
        "version": "0.1.0"
    }));
    s.set_persona("# Exchange Test Persona\nThis brain was signed by the Rust core.".into());
    s.set_readme("A brain exported from Rust and verified by the TS core.".into());

    let out = s.export(true).expect("export must succeed");
    assert_eq!(out["signed"], true);
    assert_eq!(out["verified"], true);

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(out["bytesBase64"].as_str().unwrap())
        .expect("valid base64");

    // Write to target/ so the TS verify-file script can read it
    let target_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
    std::fs::create_dir_all(&target_dir).ok();
    std::fs::write(target_dir.join("exchange-test.uniqent"), &bytes)
        .expect("write exchange artifact");

    println!("Wrote {} bytes to target/exchange-test.uniqent", bytes.len());
}
