# Studio Native Phase 2 (Rust Core Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Rust `uniqent-core` module (digest/pack/unpack/sign/verify/secret-scan) proven byte-compatible with the TS core via committed cross-impl fixtures, wired into a live `export` command so the native Studio.app produces a `.uniqent` the CLI and registry accept.

**Architecture:** Core logic lives in `apps/studio/src-tauri/src/core/` (modules: `bundle`, `digest`, `archive`, `signing`, `secret_scan`). The compatibility contract: (1) `canonical_digest` produces the identical hex to TS for the same files — this is what signatures sign, and it is archive-independent by design (sha256 over sorted `path\n<sha256(bytes) hex>\n` lines, `signature.json` excluded); (2) Rust verifies TS-signed bundles and vice versa (ed25519 over the digest string's UTF-8); (3) Rust-packed tar.gz is readable by TS `unpack` (byte-identical archives are NOT required). Fixtures are TS-emitted and committed; `cargo test` asserts against them (CI `studio-rust` job already runs cargo).

**Tech Stack:** Rust crates `sha2`, `ed25519-dalek` (+`rand_core`), `tar`, `flate2`, `base64` (already present), `serde_json`, `time` (ISO timestamp). TS side: `tsx` emit scripts, Vitest drift guards.

## Global Constraints

- Repo `uniqent`, branch `feat/studio-native` (continues Phase 1; Phase 1 commits are merged into this branch already). Commit here. Cargo needs `source "$HOME/.cargo/env"`.
- **The TS core is the reference implementation** — `packages/core/src/{digest,signing,archive,secret-scan,validate,bundle}.ts`. When in doubt, read it; never guess. Key facts (verified):
  - `PATHS.signature = 'signature.json'`, `PATHS.manifest = 'uniqent.json'`, persona at `identity/persona.md`, readme `README.md` (full map in `bundle.ts`).
  - `canonicalDigest`: entries minus signature.json, sorted by path (plain `<`/`>` string compare = byte order); canonical string = for each `${path}\n${sha256(bytes) hex}\n`; digest = sha256(canonical utf8) hex.
  - `sign`: secret-scan gate → digest → ed25519 sign over `utf8(digest string)` → `signature.json` = `JSON.stringify({algorithm:'ed25519', publicKey:<hex>, digestAlgorithm:'sha256', digest, signature:<hex>, signedAt:<ISO>}, null, 2)`. Keys hex-encoded, 32-byte seed private keys (`@noble/ed25519` `randomPrivateKey`).
  - `verify`: recompute digest, compare to signature.digest (mismatch → `reason: 'digest mismatch (content changed)'`), then ed25519-verify.
  - `pack`: secret-scan gate + `assertValid` → tar (entries sorted, `mtime: new Date(0)`, `mode: 0o644`) → gzip. `unpack`: gunzip → tar → files map.
- Digest hex equality and cross-verification are the hard gates; identical tar.gz bytes are NOT required (digest is archive-independent).
- Export contract (must match TS `session.export`): `{ filename: '<manifest.name>.uniqent', bytesBase64: <standard base64 w/ padding>, signed: bool, verified: bool, validation: {ok, errors, warnings} }`. Signing uses an ephemeral per-session keypair generated on first signed export.
- Secret-scan port: rules from `packages/core/src/secret-scan.ts` (113 lines); a finding aborts sign/pack, mirroring `SecretScanError` behavior (Rust: `Err(String)` listing findings).
- Validation for export reuses the Phase 1 `validation` assembly (fixture-pinned); full validateBundle parity is Phase 3 scope.
- Only `web/src/api.ts` (+ its test) may change in web/src: swap `exportBrain` (check the real method name in api.ts) from `soon()` to `invoke('export', { sign })`.
- Gates per task: `cargo test` + `cargo clippy --all-targets -- -D warnings` clean; repo `pnpm --filter @uniqent/studio typecheck && pnpm --filter @uniqent/studio test` green. `pnpm format` before each commit.
- Commit after every task. DRY, YAGNI, TDD.

---

## File Structure

- `apps/studio/src-tauri/src/core/mod.rs` (create) — `pub mod bundle; digest; archive; signing; secret_scan;`
- `apps/studio/src-tauri/src/core/bundle.rs` (create) — `Bundle` = ordered file map + PATHS consts.
- `apps/studio/src-tauri/src/core/digest.rs` (create) — `canonical_digest(&Bundle) -> String`.
- `apps/studio/src-tauri/src/core/archive.rs` (create) — `pack(&Bundle) -> Result<Vec<u8>>`, `unpack(&[u8]) -> Result<Bundle>`.
- `apps/studio/src-tauri/src/core/signing.rs` (create) — `generate_keypair`, `sign`, `verify`.
- `apps/studio/src-tauri/src/core/secret_scan.rs` (create) — `scan_for_secrets(&Bundle) -> Vec<Finding>`.
- `apps/studio/src-tauri/src/session.rs` (modify) — `export(sign) -> Result<Value, String>` + session keypair.
- `apps/studio/src-tauri/src/commands.rs`, `src/main.rs` (modify) — register `export`.
- `apps/studio/src-tauri/tests/core_test.rs` (create) — fixture + property tests.
- `apps/studio/scripts/emit-core-fixtures.ts` (create) — emits `fixtures/core/*` from the TS core.
- `apps/studio/fixtures/core/{files/…, expected-digest.txt, fixture.uniqent, fixture-signed.uniqent, keypair.json}` (create, generated).
- `apps/studio/test/core-fixtures.test.ts` (create) — TS drift guard for the core fixtures.
- `apps/studio/scripts/verify-file.ts` (create) — TS verifier CLI for the cross-language exchange check.
- `apps/studio/web/src/api.ts` + `api.test.ts` (modify) — export goes live.

---

## Task 1: Core fixtures from the TS core + Bundle/digest in Rust

**Files:**

- Create: `apps/studio/scripts/emit-core-fixtures.ts`, `apps/studio/fixtures/core/*` (generated), `apps/studio/test/core-fixtures.test.ts`
- Create: `apps/studio/src-tauri/src/core/mod.rs`, `core/bundle.rs`, `core/digest.rs`; modify `src/lib.rs` (`pub mod core;`), `Cargo.toml` (add `sha2 = "0.10"`)
- Test: `apps/studio/src-tauri/tests/core_test.rs`
- Modify: `apps/studio/package.json` (`"fixtures:core": "tsx scripts/emit-core-fixtures.ts"`)

**Interfaces:**

- Produces:
  - Fixtures: `fixtures/core/files/` (the fixture bundle as a directory: `uniqent.json`, `README.md`, `identity/persona.md`, `memory/facts.jsonl`), `expected-digest.txt` (the TS `canonicalDigest` hex + `\n`), `fixture.uniqent` (TS `pack` output), `fixture-signed.uniqent` (TS `sign`+`pack` output), `keypair.json` (`{privateKey, publicKey}` hex — the throwaway fixture keypair).
  - Rust: `Bundle` (`from_files(BTreeMap<String, Vec<u8>>)`, `entries()`, `get`, `set`, `has`, `paths::SIGNATURE = "signature.json"`, `paths::MANIFEST = "uniqent.json"`), `canonical_digest(&Bundle) -> String`.

- [ ] **Step 1: Write the emit script**

`apps/studio/scripts/emit-core-fixtures.ts`:

```typescript
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bundle, canonicalDigest, pack, sign, generateKeypair, writeDir } from '@uniqent/core';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'core');
await mkdir(out, { recursive: true });

// A small, deterministic bundle exercising nested paths + jsonl + manifest.
const files = new Map<string, Uint8Array>();
const put = (p: string, s: string) => files.set(p, new TextEncoder().encode(s));
put(
  'uniqent.json',
  JSON.stringify(
    {
      spec: '0.1',
      name: 'core-fixture',
      displayName: 'Core Fixture',
      version: '1.0.0',
      description: 'Cross-impl core fixture brain',
      components: {
        identity: true,
        skills: [],
        mcp: [],
        memory: { facts: 1, episodic: 0, hasProfile: false },
        tasks: [],
        channels: [],
      },
    },
    null,
    2,
  ),
);
put('README.md', '# Core fixture\n');
put('identity/persona.md', '# Persona\n\nFixture persona.\n');
put('memory/facts.jsonl', JSON.stringify({ kind: 'fact', text: 'fixture fact' }) + '\n');

const bundle = Bundle.fromFiles(files);
await writeDir(bundle, join(out, 'files'));
await writeFile(join(out, 'expected-digest.txt'), canonicalDigest(bundle) + '\n');
await writeFile(join(out, 'fixture.uniqent'), await pack(bundle, { skipValidation: true }));

// Fixed throwaway keypair, committed so both impls can use it in tests.
const kp = await generateKeypair();
await writeFile(join(out, 'keypair.json'), JSON.stringify(kp, null, 2) + '\n');
const signed = await sign(bundle, kp.privateKey);
await writeFile(join(out, 'fixture-signed.uniqent'), await pack(signed, { skipValidation: true }));

console.log('core fixtures written to', out);
```

Note: if the fixture manifest fails `@uniqent/core`'s zod schema when NOT skipping validation, that's fine — we pass `skipValidation: true` for packing; digest doesn't validate. If `Bundle.fromFiles` or `writeDir` signatures differ, read `packages/core/src/bundle.ts`/`archive.ts` and adapt minimally — the emitted artifacts are the contract, not the script's internals.

- [ ] **Step 2: Generate + add the TS drift guard**

```bash
pnpm --filter @uniqent/studio fixtures:core && ls apps/studio/fixtures/core
```

`apps/studio/test/core-fixtures.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Bundle, canonicalDigest, unpack, verify } from '@uniqent/core';

const dir = join(__dirname, '..', 'fixtures', 'core');

describe('core fixtures stay in sync with @uniqent/core', () => {
  it('the packed fixture unpacks to the committed digest', async () => {
    const b = await unpack(new Uint8Array(readFileSync(join(dir, 'fixture.uniqent'))));
    expect(canonicalDigest(b) + '\n').toBe(readFileSync(join(dir, 'expected-digest.txt'), 'utf8'));
  });
  it('the signed fixture verifies with the committed key', async () => {
    const b = await unpack(new Uint8Array(readFileSync(join(dir, 'fixture-signed.uniqent'))));
    const kp = JSON.parse(readFileSync(join(dir, 'keypair.json'), 'utf8')) as { publicKey: string };
    const v = await verify(b);
    expect(v).toMatchObject({ signed: true, valid: true, publicKey: kp.publicKey });
  });
  it('signature.json does not change the digest', async () => {
    const b = await unpack(new Uint8Array(readFileSync(join(dir, 'fixture-signed.uniqent'))));
    expect(canonicalDigest(b) + '\n').toBe(readFileSync(join(dir, 'expected-digest.txt'), 'utf8'));
  });
});
```

Run: `pnpm --filter @uniqent/studio test` → all green (38 + 3).

- [ ] **Step 3: Write the failing Rust test (digest only this task)**

`apps/studio/src-tauri/tests/core_test.rs`:

```rust
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use uniqent_studio::core::bundle::Bundle;
use uniqent_studio::core::digest::canonical_digest;

fn core_fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/core")
}

/// Load fixtures/core/files/** into a Bundle (paths relative, forward slashes).
fn fixture_bundle() -> Bundle {
    fn walk(dir: &Path, root: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for e in fs::read_dir(dir).expect("readable") {
            let p = e.expect("entry").path();
            if p.is_dir() {
                walk(&p, root, files);
            } else {
                let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                files.insert(rel, fs::read(&p).expect("file"));
            }
        }
    }
    let root = core_fixtures().join("files");
    let mut files = BTreeMap::new();
    walk(&root, &root, &mut files);
    Bundle::from_files(files)
}

fn expected_digest() -> String {
    fs::read_to_string(core_fixtures().join("expected-digest.txt"))
        .expect("digest fixture")
        .trim()
        .to_string()
}

#[test]
fn digest_matches_ts_core() {
    assert_eq!(canonical_digest(&fixture_bundle()), expected_digest());
}

#[test]
fn digest_ignores_signature_json() {
    let mut b = fixture_bundle();
    b.set("signature.json", b"{\"anything\": true}".to_vec());
    assert_eq!(canonical_digest(&b), expected_digest());
}

#[test]
fn digest_changes_when_content_changes() {
    let mut b = fixture_bundle();
    b.set("README.md", b"tampered".to_vec());
    assert_ne!(canonical_digest(&b), expected_digest());
}
```

Run: `cargo test --test core_test` → FAIL (no `core` module).

- [ ] **Step 4: Implement bundle.rs + digest.rs**

`core/bundle.rs`:

```rust
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
```

`core/digest.rs`:

```rust
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
```

`core/mod.rs`: `pub mod bundle; pub mod digest;` — `lib.rs` gains `pub mod core;`. Cargo.toml gains `sha2 = "0.10"`.

(BTreeMap's byte-wise Ord on String matches JS `<`-comparison on ASCII paths; all PATHS are ASCII. If a fixture ever introduces non-ASCII paths, revisit.)

- [ ] **Step 5: Run tests + gates, commit**

```bash
cargo test --test core_test && cargo clippy --all-targets -- -D warnings
cd ../../.. && pnpm --filter @uniqent/studio test && pnpm --filter @uniqent/studio typecheck && pnpm format
git add apps/studio && git commit -m "feat(studio-core): Bundle + canonical_digest, cross-impl digest fixtures"
```

Expected: 3 new cargo tests + all prior green.

---

## Task 2: tar.gz pack/unpack

**Files:**

- Create: `apps/studio/src-tauri/src/core/archive.rs`; modify `core/mod.rs`, `Cargo.toml` (`tar = "0.4"`, `flate2 = "1"`)
- Test: extend `apps/studio/src-tauri/tests/core_test.rs`

**Interfaces:**

- Produces: `pack(&Bundle) -> Result<Vec<u8>, String>` (tar entries sorted, mtime 0, mode 0o644, then gzip; NO validation gates yet — added in Task 4), `unpack(&[u8]) -> Result<Bundle, String>`.

- [ ] **Step 1: Failing tests** (append to `core_test.rs`)

```rust
use uniqent_studio::core::archive::{pack, unpack};

#[test]
fn unpacks_the_ts_packed_fixture_to_the_same_digest() {
    let bytes = fs::read(core_fixtures().join("fixture.uniqent")).expect("fixture.uniqent");
    let b = unpack(&bytes).expect("TS-packed archive is readable");
    assert_eq!(canonical_digest(&b), expected_digest());
}

#[test]
fn rust_pack_roundtrips_and_preserves_digest() {
    let b = fixture_bundle();
    let packed = pack(&b).expect("packs");
    let back = unpack(&packed).expect("unpacks own output");
    assert_eq!(canonical_digest(&back), expected_digest());
}
```

Run: `cargo test --test core_test` → FAIL (no `archive`).

- [ ] **Step 2: Implement `archive.rs`**

```rust
use std::io::{Read, Write};

use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;

use super::bundle::Bundle;

/// tar+gzip, mirroring packages/core/src/archive.ts (sorted entries, mtime 0, mode 0644).
/// Byte-identical output to TS is NOT required — digest is archive-independent.
pub fn pack(bundle: &Bundle) -> Result<Vec<u8>, String> {
    let gz = GzEncoder::new(Vec::new(), Compression::default());
    let mut tar = tar::Builder::new(gz);
    for (path, bytes) in bundle.entries() {
        let mut h = tar::Header::new_ustar();
        h.set_size(bytes.len() as u64);
        h.set_mode(0o644);
        h.set_mtime(0);
        h.set_cksum();
        tar.append_data(&mut h, path, bytes.as_slice()).map_err(|e| e.to_string())?;
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
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        files.insert(path, bytes);
    }
    Ok(Bundle::from_files(files))
}
```

- [ ] **Step 3: Gates + commit**

```bash
cargo test --test core_test && cargo clippy --all-targets -- -D warnings && pnpm format
git add apps/studio/src-tauri && git commit -m "feat(studio-core): tar.gz pack/unpack, reads TS-packed bundles"
```

---

## Task 3: ed25519 sign/verify

**Files:**

- Create: `apps/studio/src-tauri/src/core/signing.rs`; modify `core/mod.rs`, `Cargo.toml` (`ed25519-dalek = { version = "2", features = ["rand_core"] }`, `rand = "0.8"`, `time = { version = "0.3", features = ["formatting"] }`, `hex = "0.4"`)
- Test: extend `core_test.rs`

**Interfaces:**

- Produces:
  - `generate_keypair() -> Keypair` where `Keypair { private_key: String, public_key: String }` (hex; private = 32-byte seed, matching `@noble/ed25519`).
  - `sign(bundle: &Bundle, private_key_hex: &str) -> Result<Bundle, String>` — NO secret-scan gate yet (Task 4 adds it); computes digest, signs `digest.as_bytes()`, sets `signature.json` = pretty-2-space JSON with keys in order `algorithm, publicKey, digestAlgorithm, digest, signature, signedAt` (ISO-8601 UTC, e.g. `2026-07-05T12:00:00.000Z` format — match `Date.toISOString()`: milliseconds + `Z`).
  - `verify(bundle: &Bundle) -> VerifyResult` with `VerifyResult { signed: bool, valid: bool, reason: Option<String>, public_key: Option<String> }`; digest mismatch reason exactly `digest mismatch (content changed)`, bad sig `invalid signature`.

- [ ] **Step 1: Failing tests** (append to `core_test.rs`)

```rust
use uniqent_studio::core::signing::{generate_keypair, sign, verify};

#[test]
fn verifies_the_ts_signed_fixture() {
    let bytes = fs::read(core_fixtures().join("fixture-signed.uniqent")).expect("signed fixture");
    let b = unpack(&bytes).expect("unpacks");
    let kp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(core_fixtures().join("keypair.json")).unwrap()).unwrap();
    let v = verify(&b);
    assert!(v.signed && v.valid, "TS-signed bundle must verify in Rust: {:?}", v.reason);
    assert_eq!(v.public_key.as_deref(), kp["publicKey"].as_str());
}

#[test]
fn rust_sign_self_verifies_and_ts_keypair_signs() {
    // With the committed TS keypair: Rust-signed bundle verifies (same key derivation).
    let kp: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(core_fixtures().join("keypair.json")).unwrap()).unwrap();
    let signed = sign(&fixture_bundle(), kp["privateKey"].as_str().unwrap()).expect("signs");
    let v = verify(&signed);
    assert!(v.signed && v.valid);
    assert_eq!(v.public_key.as_deref(), kp["publicKey"].as_str());
    // And a fresh Rust keypair round-trips too.
    let fresh = generate_keypair();
    let signed2 = sign(&fixture_bundle(), &fresh.private_key).expect("signs");
    assert!(verify(&signed2).valid);
}

#[test]
fn tampered_content_fails_verification_with_exact_reason() {
    let bytes = fs::read(core_fixtures().join("fixture-signed.uniqent")).unwrap();
    let mut b = unpack(&bytes).unwrap();
    b.set("README.md", b"tampered".to_vec());
    let v = verify(&b);
    assert!(v.signed && !v.valid);
    assert_eq!(v.reason.as_deref(), Some("digest mismatch (content changed)"));
}
```

Run → FAIL (no `signing`).

- [ ] **Step 2: Implement `signing.rs`**

```rust
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::{json, Value};

use super::bundle::{paths, Bundle};
use super::digest::canonical_digest;

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
        now.year(), u8::from(now.month()), now.day(),
        now.hour(), now.minute(), now.second(), now.millisecond()
    )
}

/// Port of core sign() MINUS the secret-scan gate (added by the caller in Task 4).
pub fn sign(bundle: &Bundle, private_key_hex: &str) -> Result<Bundle, String> {
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
        serde_json::to_string_pretty(&signature).map_err(|e| e.to_string())?.into_bytes(),
    );
    Ok(out)
}

pub fn verify(bundle: &Bundle) -> VerifyResult {
    let Some(raw) = bundle.get(paths::SIGNATURE) else {
        return VerifyResult { signed: false, valid: false, reason: None, public_key: None };
    };
    let sig_json: Value = match serde_json::from_slice(raw) {
        Ok(v) => v,
        Err(e) => return VerifyResult { signed: true, valid: false, reason: Some(e.to_string()), public_key: None },
    };
    let public_key = sig_json["publicKey"].as_str().map(String::from);
    let recomputed = canonical_digest(bundle);
    if sig_json["digest"].as_str() != Some(recomputed.as_str()) {
        return VerifyResult {
            signed: true, valid: false,
            reason: Some("digest mismatch (content changed)".into()),
            public_key,
        };
    }
    let ok = (|| -> Option<bool> {
        let pk_bytes: [u8; 32] = hex::decode(public_key.as_deref()?).ok()?.try_into().ok()?;
        let vk = VerifyingKey::from_bytes(&pk_bytes).ok()?;
        let sig_bytes: [u8; 64] = hex::decode(sig_json["signature"].as_str()?).ok()?.try_into().ok()?;
        Some(vk.verify(recomputed.as_bytes(), &Signature::from_bytes(&sig_bytes)).is_ok())
    })()
    .unwrap_or(false);
    VerifyResult {
        signed: true,
        valid: ok,
        reason: if ok { None } else { Some("invalid signature".into()) },
        public_key,
    }
}
```

(`json!` preserves the written key order via serde_json's default preserve_order? It does NOT by default — `serde_json::Map` is a BTreeMap alphabetical unless the `preserve_order` feature is on. **Enable it**: `serde_json = { version = "1", features = ["preserve_order"] }` so signature.json key order matches TS. Order isn't digest-relevant but keeps files diff-identical for humans and any strict parsers.)

- [ ] **Step 3: Gates + commit**

```bash
cargo test --test core_test && cargo clippy --all-targets -- -D warnings && pnpm format
git add apps/studio/src-tauri && git commit -m "feat(studio-core): ed25519 sign/verify, cross-verifies with TS core"
```

---

## Task 4: secret-scan port + gated pack/sign

**Files:**

- Create: `apps/studio/src-tauri/src/core/secret_scan.rs`; modify `core/mod.rs`, `core/archive.rs` + `core/signing.rs` (add the gates), `Cargo.toml` (`regex = "1"`)
- Test: extend `core_test.rs`

**Interfaces:**

- Produces: `Finding { path: String, hint: String }`, `scan_for_secrets(&Bundle) -> Vec<Finding>`; `pack_checked(&Bundle) -> Result<Vec<u8>, String>` (scan gate; validation stays Phase 3 — document that divergence from TS `pack` which also calls assertValid) and `sign` gaining the scan gate at the top (matching TS `sign`). Error message format: `secret scan failed: <path>: <hint>[; …]`.

- [ ] **Step 1: Port the rules**

Read `packages/core/src/secret-scan.ts` (113 lines) end-to-end. Port every pattern + the `isLikelySecretValue` heuristics into `secret_scan.rs` with the same match semantics (case-insensitivity flags, key-name lists, value-entropy/length rules — whatever the file actually does; the file is the spec). Keep rule order and hint strings recognizably parallel for future diffing.

- [ ] **Step 2: Failing tests** (append to `core_test.rs`)

```rust
use uniqent_studio::core::archive::pack_checked;
use uniqent_studio::core::secret_scan::scan_for_secrets;

#[test]
fn clean_fixture_has_no_findings_and_packs() {
    assert!(scan_for_secrets(&fixture_bundle()).is_empty());
    assert!(pack_checked(&fixture_bundle()).is_ok());
}

#[test]
fn a_planted_secret_blocks_pack_and_sign() {
    let mut b = fixture_bundle();
    // A canonical AWS-style access key — pick a pattern the TS scanner catches (read its tests).
    b.set("mcp/servers.json", br#"{"env": {"AWS_SECRET_ACCESS_KEY": "AKIAIOSFODNN7EXAMPLEKEY9"}}"#.to_vec());
    assert!(!scan_for_secrets(&b).is_empty(), "planted secret must be found");
    assert!(pack_checked(&b).is_err());
    let kp = generate_keypair();
    assert!(sign(&b, &kp.private_key).is_err(), "sign must gate on the scan");
}
```

(If the TS scanner's tests — `packages/core/test/` — use different canonical planted secrets, use THOSE exact strings so both scanners demonstrably catch the same input.)

- [ ] **Step 3: Implement, gates, commit**

```bash
cargo test --test core_test && cargo clippy --all-targets -- -D warnings && pnpm format
git add apps/studio/src-tauri && git commit -m "feat(studio-core): secret-scan port; pack/sign gated"
```

---

## Task 5: live `export` command + shim + cross-language exchange check

**Files:**

- Modify: `apps/studio/src-tauri/src/session.rs` (export + session keypair), `commands.rs`, `main.rs`
- Modify: `apps/studio/web/src/api.ts`, `web/src/api.test.ts`
- Create: `apps/studio/scripts/verify-file.ts`
- Modify: `apps/studio/README.md`

**Interfaces:**

- Consumes: Tasks 1–4 (`canonical_digest`, `pack_checked`, `sign`, `verify`, `generate_keypair`).
- Produces: Tauri command `export(sign: bool) -> Result<Value, String>` returning `{ filename, bytesBase64, signed, verified, validation }` exactly like TS `session.export`; api.ts routes the export method (its real name is in api.ts — currently a `soon()` stub) to `invoke('export', { sign })`.

- [ ] **Step 1: Failing tests**

Rust (append to `core_test.rs` or a new `tests/export_test.rs` using `uniqent_studio::session::Session`):

```rust
#[test]
fn export_produces_verifiable_signed_bundle() {
    let mut s = uniqent_studio::session::Session::new();
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
```

Web (extend `api.test.ts`): the export method now calls `invoke('export', { sign: true })` under Tauri instead of rejecting (mirror the existing invoke-routing test pattern; remove/adjust the coming-soon expectation if it referenced export).

- [ ] **Step 2: Implement**

- `Session::export(&mut self, sign_it: bool) -> Result<Value, String>`: build a `Bundle` from the session (manifest JSON = the same manifest `state()` emits, plus `README.md`/`identity/persona.md`/avatar file when present — reuse the state-assembly internals so manifest bytes match what validation saw); `validation` = the same Value `state()` reports; if `sign_it`: lazily `generate_keypair()` into `self.keypair: Option<Keypair>`, `sign(...)`; `pack_checked(...)`; base64 STANDARD encode; verified = `verify(&signed).valid` when signed else false.
- Register `export` in commands.rs/main.rs (`#[tauri::command] pub fn export(s: State<AppState>, sign: bool) -> Result<Value, String>`).
- api.ts: swap the export stub to `invoke('export', { sign })`, keeping the browser fetch branch as-is.

- [ ] **Step 3: TS verifier CLI for the exchange check**

`apps/studio/scripts/verify-file.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { unpack, verify, canonicalDigest } from '@uniqent/core';

const file = process.argv[2];
if (!file) throw new Error('usage: tsx scripts/verify-file.ts <bundle.uniqent>');
const b = await unpack(new Uint8Array(readFileSync(file)));
const v = await verify(b);
console.log(JSON.stringify({ digest: canonicalDigest(b), ...v }, null, 2));
if (!v.signed || !v.valid) process.exit(1);
console.log('OK: TS core verifies this bundle');
```

- [ ] **Step 4: Run the exchange check (the money shot — record it)**

Add a small ignored-by-default Rust test that WRITES a Rust-exported signed bundle to `target/exchange-test.uniqent` (`#[test] #[ignore] fn write_exchange_artifact()` doing the export steps and `fs::write`). Then:

```bash
cd apps/studio/src-tauri && cargo test --test export_test -- --ignored write_exchange_artifact
cd .. && pnpm exec tsx scripts/verify-file.ts src-tauri/target/exchange-test.uniqent
```

Expected: `OK: TS core verifies this bundle`. **Paste this output into the task report** — it is the cross-implementation proof the whole phase exists for.

- [ ] **Step 5: Gates, docs, commit**

- README: update the phase-scope paragraph — export now live natively; memory/hubs/install still later phases.
- Full gates: `cargo test && cargo clippy --all-targets -- -D warnings` + `pnpm --filter @uniqent/studio test && pnpm --filter @uniqent/studio typecheck` + `pnpm format`.

```bash
git add apps/studio && git commit -m "feat(studio): native export — Rust core pack/sign, TS-verified exchange"
```

- [ ] **Step 6: Human smoke test (report, don't skip)**

`pnpm --filter @uniqent/studio native:dev` → build a small brain → Export (signed) → the browser-style download should produce a `.uniqent` (if the WKWebView blob download does nothing, report it — the fallback is a Tauri save-dialog, a scoped follow-up). Then `uniqent validate <file>` and `uniqent inspect <file>` from the CLI.

---

## Notes for the implementer

- **The TS core is the spec.** Every module names its reference file; read it before coding. The committed fixtures + exchange check are the acceptance gates — never adjust a fixture to make Rust pass.
- **serde_json `preserve_order` feature is required** (Task 3) for signature.json key-order parity.
- **Full validateBundle parity is Phase 3** — export reuses Phase 1's fixture-pinned validation subset; note this in code comments where TS `pack` would call `assertValid`.
- Prettier before every commit (`pnpm format`); CI runs prettier + the `studio-rust` cargo job.
