use sha2::{Digest, Sha256};

use super::bundle::{paths, Bundle};

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex_encode(&h.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Port of packages/core/src/digest.ts — sha256 over sorted `path\n<file sha256 hex>\n` lines,
/// signature.json excluded. Archive-independent by construction.
pub fn canonical_digest(bundle: &Bundle) -> String {
    let mut canonical = String::new();
    for (path, bytes) in bundle.entries() {
        if path == paths::SIGNATURE {
            continue;
        }
        canonical.push_str(path);
        canonical.push('\n');
        canonical.push_str(&sha256_hex(bytes));
        canonical.push('\n');
    }
    sha256_hex(canonical.as_bytes())
}
