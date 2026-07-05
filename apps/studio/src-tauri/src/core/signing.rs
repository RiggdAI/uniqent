use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::{json, Value};

use super::bundle::{paths, Bundle};
use super::digest::canonical_digest;
use super::secret_scan::{format_scan_error, scan_for_secrets};

pub struct Keypair {
    pub private_key: String,
    pub public_key: String,
}

pub struct VerifyResult {
    pub signed: bool,
    pub valid: bool,
    pub reason: Option<String>,
    pub public_key: Option<String>,
}

pub fn generate_keypair() -> Keypair {
    let sk = SigningKey::generate(&mut rand::rngs::OsRng);
    Keypair {
        private_key: hex::encode(sk.to_bytes()),
        public_key: hex::encode(sk.verifying_key().to_bytes()),
    }
}

fn signing_key(private_key_hex: &str) -> Result<SigningKey, String> {
    let bytes: [u8; 32] = hex::decode(private_key_hex)
        .map_err(|e| e.to_string())?
        .try_into()
        .map_err(|_| "private key must be 32 bytes".to_string())?;
    Ok(SigningKey::from_bytes(&bytes))
}

fn iso_now() -> String {
    // Match Date.toISOString(): 2026-07-05T12:00:00.000Z
    let now = time::OffsetDateTime::now_utc();
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        now.year(),
        u8::from(now.month()),
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond()
    )
}

/// Port of TS core `sign()`. Runs secret-scan gate before computing the digest,
/// matching the TS `sign` which calls `scanForSecrets` at the very top.
pub fn sign(bundle: &Bundle, private_key_hex: &str) -> Result<Bundle, String> {
    // Secret-scan gate — mirrors TS sign() which calls scanForSecrets before anything else.
    let findings = scan_for_secrets(bundle);
    if !findings.is_empty() {
        return Err(format_scan_error(&findings));
    }

    let digest = canonical_digest(bundle);
    let sk = signing_key(private_key_hex)?;
    let sig = sk.sign(digest.as_bytes());
    let signature = json!({
        "algorithm": "ed25519",
        "publicKey": hex::encode(sk.verifying_key().to_bytes()),
        "digestAlgorithm": "sha256",
        "digest": digest,
        "signature": hex::encode(sig.to_bytes()),
        "signedAt": iso_now(),
    });
    let mut out = bundle.clone();
    out.set(
        paths::SIGNATURE,
        serde_json::to_string_pretty(&signature)
            .map_err(|e| e.to_string())?
            .into_bytes(),
    );
    Ok(out)
}

pub fn verify(bundle: &Bundle) -> VerifyResult {
    let Some(raw) = bundle.get(paths::SIGNATURE) else {
        return VerifyResult {
            signed: false,
            valid: false,
            reason: None,
            public_key: None,
        };
    };
    let sig_json: Value = match serde_json::from_slice(raw) {
        Ok(v) => v,
        Err(e) => {
            return VerifyResult {
                signed: true,
                valid: false,
                reason: Some(e.to_string()),
                public_key: None,
            }
        }
    };
    let public_key = sig_json["publicKey"].as_str().map(String::from);
    let recomputed = canonical_digest(bundle);
    if sig_json["digest"].as_str() != Some(recomputed.as_str()) {
        return VerifyResult {
            signed: true,
            valid: false,
            reason: Some("digest mismatch (content changed)".into()),
            public_key,
        };
    }
    let ok = (|| -> Option<bool> {
        let pk_bytes: [u8; 32] = hex::decode(public_key.as_deref()?).ok()?.try_into().ok()?;
        let vk = VerifyingKey::from_bytes(&pk_bytes).ok()?;
        let sig_bytes: [u8; 64] = hex::decode(sig_json["signature"].as_str()?)
            .ok()?
            .try_into()
            .ok()?;
        Some(
            vk.verify(recomputed.as_bytes(), &Signature::from_bytes(&sig_bytes))
                .is_ok(),
        )
    })()
    .unwrap_or(false);
    VerifyResult {
        signed: true,
        valid: ok,
        reason: if ok {
            None
        } else {
            Some("invalid signature".into())
        },
        public_key,
    }
}
