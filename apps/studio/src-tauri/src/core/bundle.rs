use std::collections::BTreeMap;

pub mod paths {
    pub const MANIFEST: &str = "uniqent.json";
    pub const SIGNATURE: &str = "signature.json";
}

/// An in-memory .uniqent: path -> bytes. BTreeMap keeps entries byte-sorted,
/// matching the TS core's sorted-entries canonical order.
#[derive(Clone, Default)]
pub struct Bundle {
    files: BTreeMap<String, Vec<u8>>,
}

impl Bundle {
    pub fn from_files(files: BTreeMap<String, Vec<u8>>) -> Self {
        Self { files }
    }
    pub fn entries(&self) -> impl Iterator<Item = (&String, &Vec<u8>)> {
        self.files.iter()
    }
    pub fn get(&self, path: &str) -> Option<&Vec<u8>> {
        self.files.get(path)
    }
    pub fn set(&mut self, path: &str, bytes: Vec<u8>) {
        self.files.insert(path.to_string(), bytes);
    }
    pub fn has(&self, path: &str) -> bool {
        self.files.contains_key(path)
    }
}
