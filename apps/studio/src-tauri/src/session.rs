use base64::Engine;
use serde_json::{json, Map, Value};

use crate::core::archive::pack_checked;
use crate::core::bundle::Bundle;
use crate::core::signing::{generate_keypair, sign, verify, Keypair};

pub struct Session {
    name: String,
    display_name: String,
    description: String,
    version: String,
    targets: Vec<String>,
    persona: Option<String>,
    readme: Option<String>,
    avatar: Option<String>, // data: URL, validated on set
    keypair: Option<Keypair>,
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

impl Session {
    pub fn new() -> Self {
        Session {
            name: "my-brain".into(),
            display_name: "My Brain".into(),
            description: "A portable agent brain.".into(),
            version: "0.1.0".into(),
            targets: vec![],
            persona: None,
            readme: None,
            avatar: None,
            keypair: None,
        }
    }

    pub fn state(&self) -> Value {
        let identity = self.persona.is_some();

        let manifest = json!({
            "specVersion": "0.1",
            "name": self.name,
            "displayName": self.display_name,
            "version": self.version,
            "description": self.description,
            "author": { "name": "Anonymous" },
            "license": "CC0-1.0",
            "tags": [],
            "components": {
                "identity": identity,
                "memory": {
                    "facts": 0,
                    "episodic": 0,
                    "hasProfile": false
                },
                "skills": [],
                "mcp": [],
                "tools": [],
                "tasks": [],
                "channels": []
            },
            "credentials": [],
            "permissions": {
                "filesystem": {
                    "read": [],
                    "write": []
                },
                "network": {
                    "endpoints": []
                },
                "autonomy": "suggest",
                "spawnsProcesses": false
            },
            "compatibility": {
                "targets": self.targets
            }
        });

        let validation = json!({
            "ok": true,
            "errors": [],
            "warnings": []
        });

        let mut map = Map::new();
        map.insert("manifest".into(), manifest);
        map.insert("validation".into(), validation);
        if let Some(p) = &self.persona {
            map.insert("persona".into(), Value::String(p.clone()));
        }
        if let Some(r) = &self.readme {
            map.insert("readme".into(), Value::String(r.clone()));
        }
        if let Some(a) = &self.avatar {
            map.insert("avatar".into(), Value::String(a.clone()));
        }
        Value::Object(map)
    }

    pub fn catalog(&self) -> Value {
        serde_json::from_str(include_str!("../../fixtures/catalog.json"))
            .expect("catalog.json valid")
    }

    pub fn set_meta(&mut self, meta: Value) {
        if let Some(name) = meta.get("name").and_then(|v| v.as_str()) {
            self.name = name.to_string();
        }
        if let Some(desc) = meta.get("description").and_then(|v| v.as_str()) {
            self.description = desc.to_string();
        }
        if let Some(ver) = meta.get("version").and_then(|v| v.as_str()) {
            self.version = ver.to_string();
        }
        // Note: displayName is NOT updated by set_meta (matches TS behavior)
    }

    pub fn set_targets(&mut self, targets: Vec<String>) {
        self.targets = targets;
    }

    pub fn set_persona(&mut self, md: String) {
        // Mirror TS Brain.setPersona: stores verbatim (including ""), key stays present.
        // identity = persona.is_some(), so set_persona("") → identity: true.
        self.persona = Some(md);
    }

    pub fn set_readme(&mut self, md: String) {
        // Mirror TS Brain.setReadme: trim-empty clears (whitespace-only drops the key).
        if md.trim().is_empty() {
            self.readme = None;
        } else {
            self.readme = Some(md);
        }
    }

    pub fn set_avatar(&mut self, data_url: String) -> Result<(), String> {
        // Phase 1 intentionally accepts only png/jpeg/webp (TS also allows gif/svg; parity deferred to a later phase).
        let trimmed = data_url.trim();

        // Check supported prefixes
        let prefix_and_b64 = trimmed
            .strip_prefix("data:image/png;base64,")
            .or_else(|| trimmed.strip_prefix("data:image/jpeg;base64,"))
            .or_else(|| trimmed.strip_prefix("data:image/webp;base64,"));

        match prefix_and_b64 {
            None => Err("unsupported avatar format".into()),
            Some(b64) => {
                // Decode to check size
                let decoded = base64::engine::general_purpose::STANDARD_NO_PAD
                    .decode(b64)
                    .or_else(|_| base64::engine::general_purpose::STANDARD.decode(b64))
                    .map_err(|_| "unsupported avatar format".to_string())?;

                if decoded.len() > 512 * 1024 {
                    return Err("avatar too large (max 512KB)".into());
                }
                self.avatar = Some(trimmed.to_string());
                Ok(())
            }
        }
    }

    pub fn remove_avatar(&mut self) {
        self.avatar = None;
    }

    /// Build a Bundle from the current session state.
    /// manifest JSON = the same manifest value state() emits, plus optional files.
    fn build_bundle(&self) -> Bundle {
        let state = self.state();
        let manifest_value = &state["manifest"];
        let manifest_json = serde_json::to_string_pretty(manifest_value)
            .expect("manifest serialises");

        let mut bundle = Bundle::default();
        bundle.set("uniqent.json", manifest_json.into_bytes());

        if let Some(readme) = &self.readme {
            if !readme.trim().is_empty() {
                bundle.set("README.md", readme.as_bytes().to_vec());
            }
        }
        if let Some(persona) = &self.persona {
            bundle.set("identity/persona.md", persona.as_bytes().to_vec());
        }
        if let Some(data_url) = &self.avatar {
            // Parse data:<mime>;base64,<b64> to extract ext + raw bytes
            if let Some(rest) = data_url.strip_prefix("data:image/") {
                if let Some(semi_pos) = rest.find(';') {
                    let raw_ext = &rest[..semi_pos];
                    let ext = raw_ext.to_lowercase();
                    let ext = if ext == "jpeg" { "jpg" } else { &ext };
                    if let Some(b64) = rest[semi_pos..].strip_prefix(";base64,") {
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD
                            .decode(b64)
                            .or_else(|_| {
                                base64::engine::general_purpose::STANDARD_NO_PAD.decode(b64)
                            })
                        {
                            bundle.set(&format!("avatar.{ext}"), bytes);
                        }
                    }
                }
            }
        }
        bundle
    }

    /// Export the current brain as a signed or unsigned .uniqent bundle.
    ///
    /// NOTE: validation is Phase 1's subset (see pack_checked); full assertValid parity
    /// with TS pack is deferred to Phase 3.
    pub fn export(&mut self, sign_it: bool) -> Result<Value, String> {
        let state = self.state();
        let validation = state["validation"].clone();
        let name = self.name.clone();

        let bundle = self.build_bundle();

        let (final_bundle, signed) = if sign_it {
            if self.keypair.is_none() {
                self.keypair = Some(generate_keypair());
            }
            let kp = self.keypair.as_ref().unwrap();
            let signed_bundle = sign(&bundle, &kp.private_key)?;
            (signed_bundle, true)
        } else {
            (bundle, false)
        };

        let bytes = pack_checked(&final_bundle)?;
        let verified = if signed { verify(&final_bundle).valid } else { false };
        let bytes_b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

        Ok(json!({
            "filename": format!("{name}.uniqent"),
            "bytesBase64": bytes_b64,
            "signed": signed,
            "verified": verified,
            "validation": validation,
        }))
    }

    pub fn reset(&mut self) {
        *self = Session::new();
    }
}
