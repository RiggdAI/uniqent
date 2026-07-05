use std::io::Read;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;

use super::bundle::Bundle;
use super::secret_scan::{format_scan_error, scan_for_secrets};

/// tar+gzip, mirroring packages/core/src/archive.ts (sorted entries, mtime 0, mode 0644).
/// Byte-identical output to TS is NOT required — digest is archive-independent.
///
/// NOTE: Unlike TS `pack`, this does NOT call `assertValid`. Full schema validation
/// is deliberately deferred to Phase 3 (matches the task-4 brief). The TS `pack`
/// runs assertValid before archiving; `pack_checked` only runs the secret scan.
pub fn pack_checked(bundle: &Bundle) -> Result<Vec<u8>, String> {
    let findings = scan_for_secrets(bundle);
    if !findings.is_empty() {
        return Err(format_scan_error(&findings));
    }
    pack(bundle)
}

/// Raw pack — no scan gate, no validation. Used by tests and internal pipelines.
pub fn pack(bundle: &Bundle) -> Result<Vec<u8>, String> {
    let gz = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar = tar::Builder::new(gz);
    for (path, bytes) in bundle.entries() {
        let mut h = tar::Header::new_ustar();
        h.set_size(bytes.len() as u64);
        h.set_mode(0o644);
        h.set_mtime(0);
        h.set_cksum();
        tar.append_data(&mut h, path, bytes.as_slice())
            .map_err(|e| e.to_string())?;
    }
    let gz = tar.into_inner().map_err(|e| e.to_string())?;
    gz.finish().map_err(|e| e.to_string())
}

pub fn unpack(input: &[u8]) -> Result<Bundle, String> {
    let mut archive = tar::Archive::new(GzDecoder::new(input));
    let mut files = std::collections::BTreeMap::new();
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        // Normalize any ./-prefixed paths produced by some tar writers
        let path = path.strip_prefix("./").unwrap_or(&path).to_string();
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        files.insert(path, bytes);
    }
    Ok(Bundle::from_files(files))
}
