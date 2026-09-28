use std::collections::BTreeMap;

pub mod paths {
    pub const MANIFEST: &str = "uniqent.json";
    pub const SIGNATURE: &str = "signature.json";
}

/// Why `path` is not a safe, canonical bundle path, or `None` when it is. Mirrors
/// `assertBundlePath` in packages/core/src/bundle.ts: relative, '/'-separated, no empty/'.'/'..'
/// segments, no backslashes, no control characters (a newline would make the digest ambiguous).
fn bundle_path_problem(path: &str) -> Option<&'static str> {
    if path.is_empty() {
        Some("is empty")
    } else if path.starts_with('/') {
        Some("is absolute")
    } else if path.contains('\\') {
        Some("contains a backslash")
    } else if path.chars().any(|c| c.is_ascii_control()) {
        Some("contains a control character")
    } else if path
        .split('/')
        .any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        Some("contains an empty, '.' or '..' segment")
    } else {
        None
    }
}

/// Reject a path that could escape an install root or break the canonical digest.
pub fn assert_bundle_path(path: &str) -> Result<(), String> {
    match bundle_path_problem(path) {
        Some(reason) => Err(format!("invalid bundle path {path:?}: {reason}")),
        None => Ok(()),
    }
}

/// An in-memory .uniqent: path -> bytes. BTreeMap keeps entries byte-sorted,
/// matching the TS core's sorted-entries canonical order.
#[derive(Clone, Default)]
pub struct Bundle {
    files: BTreeMap<String, Vec<u8>>,
}

impl Bundle {
    /// Build a bundle; every path must pass `assert_bundle_path`.
    pub fn from_files(files: BTreeMap<String, Vec<u8>>) -> Result<Self, String> {
        for path in files.keys() {
            assert_bundle_path(path)?;
        }
        Ok(Self { files })
    }
    pub fn entries(&self) -> impl Iterator<Item = (&String, &Vec<u8>)> {
        self.files.iter()
    }
    pub fn get(&self, path: &str) -> Option<&Vec<u8>> {
        self.files.get(path)
    }
    /// Set a file; the path must pass `assert_bundle_path`.
    pub fn set(&mut self, path: &str, bytes: Vec<u8>) -> Result<(), String> {
        assert_bundle_path(path)?;
        self.files.insert(path.to_string(), bytes);
        Ok(())
    }
    pub fn has(&self, path: &str) -> bool {
        self.files.contains_key(path)
    }
}
