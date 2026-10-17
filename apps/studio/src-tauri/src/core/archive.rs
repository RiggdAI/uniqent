use std::io::Read;

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;

use super::bundle::{assert_bundle_path, Bundle};
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

/// Upper bound on the uncompressed tar size accepted by unpack (gzip-bomb guard).
pub const MAX_UNPACKED_BYTES: u64 = 64 * 1024 * 1024;
/// Upper bound on the number of tar entries accepted by unpack.
pub const MAX_ARCHIVE_ENTRIES: usize = 10_000;

/// Read a .uniqent archive. Fails closed, like the TS core `unpack`: only regular files and
/// directories are allowed (no links or special entries), every path must pass
/// `assert_bundle_path`, names must be unique, and the archive must stay within
/// MAX_UNPACKED_BYTES uncompressed and MAX_ARCHIVE_ENTRIES entries. Directories are ignored.
pub fn unpack(input: &[u8]) -> Result<Bundle, String> {
    let mut tar_bytes = Vec::new();
    GzDecoder::new(input)
        .take(MAX_UNPACKED_BYTES + 1)
        .read_to_end(&mut tar_bytes)
        .map_err(|e| format!("archive is not valid gzip: {e}"))?;
    if tar_bytes.len() as u64 > MAX_UNPACKED_BYTES {
        return Err(format!(
            "archive expands beyond {MAX_UNPACKED_BYTES} bytes uncompressed (MAX_UNPACKED_BYTES); refusing to unpack"
        ));
    }
    let mut archive = tar::Archive::new(tar_bytes.as_slice());
    let mut files = std::collections::BTreeMap::new();
    for (i, entry) in archive.entries().map_err(|e| e.to_string())?.enumerate() {
        if i >= MAX_ARCHIVE_ENTRIES {
            return Err(format!(
                "archive has more than {MAX_ARCHIVE_ENTRIES} entries (MAX_ARCHIVE_ENTRIES)"
            ));
        }
        let mut entry = entry.map_err(|e| e.to_string())?;
        let raw = entry.path_bytes().into_owned();
        let path = String::from_utf8(raw)
            .map_err(|e| format!("archive entry name is not UTF-8: {:?}", e.as_bytes()))?;
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            assert_bundle_path(path.strip_suffix('/').unwrap_or(&path))?;
            continue;
        }
        if !kind.is_file() {
            return Err(format!(
                "archive entry {path:?} has unsupported type {kind:?} (only regular files and directories are allowed)"
            ));
        }
        assert_bundle_path(&path)?;
        if files.contains_key(&path) {
            return Err(format!("archive has duplicate entry {path:?}"));
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        files.insert(path, bytes);
    }
    Bundle::from_files(files)
}
