# M1 — Core Engine (`packages/core`) Design

**Date:** 2026-05-31
**Status:** Approved (brainstorm) — pending implementation plan
**Milestone:** M1 (see `docs/BUILD_PLAN.md` §6)

## Purpose

`@uniqent/core` is the framework-agnostic engine for reading, validating, securing, and signing
`.uniqent` bundles. It is the seam every higher layer shares: **Studio** builds a bundle in memory,
the **CLI** unpacks one from disk, and **adapters** read one uniformly. Everything in Uniqent that
touches a bundle goes through this package. It depends only on `@uniqent/spec`.

## Scope

In scope for M1:

- A `Bundle` in-memory model (virtual file map + typed, validated accessors).
- Canonical content digest.
- Fail-closed secret-scan gate.
- Validation (schema + layout + cross-reference integrity), composing the secret-scan.
- Ed25519 keygen / sign / verify.
- Archive + filesystem I/O: `.uniqent` ⇄ `Bundle` ⇄ directory.
- Credential-ref location/resolution helpers (consumed by adapters later).
- Spec addition: `MemoryItem.visibility?: 'shareable' | 'personal'` (default `'shareable'`).

Out of scope for M1 (later milestones): the builder engine (M2), Studio (M3), adapters and the
install/export flows (M4–M5), the registry (M6). Export-scrub _behavior_ lands with the export flow;
M1 only adds the `visibility` field it will rely on.

## Runtime assumption

Core is **Node-side**. Studio is a browser UI that talks to a local Node server which runs
core/builder; the browser never imports core directly. Therefore core may use `node:crypto`,
`node:zlib`, and a Node tar library without browser constraints.

## Architecture — units

Each module has one clear purpose, a well-defined interface, and is independently testable.

| Module           | Purpose                                                                                                                                                                  | Key exports                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `bundle.ts`      | The bundle model: ordered `Map<string, Uint8Array>` keyed by POSIX-relative path, with typed accessors that parse + validate against `@uniqent/spec` on demand (cached). | `Bundle`                                                             |
| `digest.ts`      | Deterministic content digest.                                                                                                                                            | `canonicalDigest(bundle): string`                                    |
| `secret-scan.ts` | Detect likely secret values.                                                                                                                                             | `scanForSecrets(bundle): SecretFinding[]`                            |
| `validate.ts`    | Schema + layout + cross-reference checks; composes secret-scan.                                                                                                          | `validateBundle(bundle): ValidationResult`, `assertValid(bundle)`    |
| `signing.ts`     | Ed25519 keygen, sign, verify.                                                                                                                                            | `generateKeypair()`, `sign(bundle, privKey)`, `verify(bundle)`       |
| `archive.ts`     | `.uniqent` ⇄ `Bundle` ⇄ directory.                                                                                                                                       | `pack()`, `unpack()`, `readDir()`, `writeDir()`                      |
| `secret-refs.ts` | Locate/resolve `${credentialRef:<ref>}` placeholders.                                                                                                                    | `findCredentialRefs(bundle)`, `resolvePlaceholders(value, resolved)` |
| `errors.ts`      | Typed error classes.                                                                                                                                                     | `BundleFormatError`, `BundleValidationError`, `SecretScanError`      |
| `index.ts`       | Public re-exports.                                                                                                                                                       | —                                                                    |

### `Bundle` model (Approach A: virtual file map + typed views)

- Wraps an ordered `Map<string, Uint8Array>` of relative POSIX paths → raw bytes. Raw bytes are
  **preserved exactly** so arbitrary/unknown files (skill `scripts/`, `references/`, future
  additions) survive round-trips losslessly.
- Construction: `Bundle.empty()`, `Bundle.fromFiles(map)`.
- Raw access: `get(path)`, `has(path)`, `set(path, bytes)`, `delete(path)`, `files()` (iterator).
- Typed accessors (parse + zod-validate on demand, memoized): `manifest()`, `persona()`,
  `policies()`, `memoryProfile()`, `memoryFacts()`, `memoryEpisodic()`, `mcpServers()`,
  `channels()`, `tools()`, `tasks()`, `runtime()`, `skillNames()`, `signature()`.
- Accessors for optional, absent components return `undefined` / `[]`; accessors throw
  `BundleFormatError` only when a present file is malformed.

## Canonical digest

Deterministic and independent of archive/order:

1. Take all files **except `signature.json`**.
2. Sort paths by byte order.
3. For each file compute `sha256(bytes)` → hex.
4. Build the canonical string, per file: `"<path>\n<sha256hex>\n"`, concatenated in sorted order.
5. `sha256` that string → final hex digest.

Because it hashes the preserved file bytes (not the tar/gzip stream), `unpack(pack(b))` reproduces
the same digest by construction. This satisfies the M1 "byte-stable content digest" acceptance and
is what `sign` covers and `verify` recomputes.

## Secret-scan (hard gate, fail-closed)

`scanForSecrets` runs inside `validate`, `pack`, and `sign`.

**Detects:**

- Known prefixes: `sk-`, `ghp_`, `gho_`, `ghu_`, `ghs_`, `xoxb-`, `xoxp-`, `AKIA` (AWS), and PEM
  blocks (`-----BEGIN … PRIVATE KEY-----`).
- High-entropy fallback: long base64/hex tokens above a Shannon-entropy threshold.

**Always allowed:** `${credentialRef:<ref>}` placeholders.

**False-positive avoidance for legitimate public key material:**

- Skips `signature.json` entirely (holds the signature, public key, and digest by design).
- Allowlists `author.pubkey` in the manifest.
- For JSON/JSONL files it walks string values (so the field allowlist applies); for `.md`/text it
  scans line by line.

**Result:** findings include `{ path, kind, snippet }`. `validateBundle` reports them as errors;
`pack` and `sign` throw `SecretScanError` (fail closed).

## Validate

`validateBundle(bundle)` composes:

1. **Manifest** — zod parse of `uniqent.json`.
2. **Component files** — parse `mcp/servers.json`, `channels/channels.json`, `tools/tools.json`,
   each `tasks/*.json`, each JSONL line in `memory/*.jsonl`, and `memory/profile.json`.
3. **Layout** — `uniqent.json` required; `identity/persona.md` present when `components.identity`;
   each `skills/<name>/` contains a `SKILL.md`.
4. **Cross-reference integrity** — every `credentialRef` used in MCP/channels resolves to a
   `manifest.credentials[].ref`; `auth.type:"header"` requires `headerName` (also enforced in spec);
   warn if `components` counts diverge from actual file contents.
5. **Secret-scan** — findings become errors.

Returns `{ ok: boolean, errors: Issue[], warnings: Issue[] }` where `Issue = { path?, message, code }`.
No throw. `assertValid(bundle)` throws `BundleValidationError` carrying the issues.

## Sign / verify

- `generateKeypair(): { publicKey: string; privateKey: string }` — hex-encoded Ed25519 keys.
- `sign(bundle, privateKey): Bundle` — runs secret-scan (gate), computes `canonicalDigest`,
  Ed25519-signs the digest bytes, and returns a **new** `Bundle` with `signature.json` added,
  matching the `Signature` schema (`algorithm:"ed25519"`, `publicKey`, `digestAlgorithm:"sha256"`,
  `digest`, `signature`, `signedAt`). `signedAt` uses the system clock (core is library code, not a
  workflow script).
- `verify(bundle): { signed: boolean; valid: boolean; reason?: string; publicKey?: string }` —
  reads `signature.json`; if absent → `{ signed:false, valid:false }`. Otherwise recomputes the
  digest, checks equality with `signature.digest`, and Ed25519-verifies the signature over the
  digest. Tampering any file changes the digest → `valid:false`. Never throws for unsigned/invalid;
  throws only on programmer misuse.

## Error handling

- Structured results where callers branch: `validateBundle`, `verify`.
- Throw to fail closed where safety demands it: `SecretScanError` (pack/sign), `BundleFormatError`
  (malformed archive / missing manifest / malformed present file), `BundleValidationError`
  (`assertValid`).
- Typed classes in `errors.ts` so the CLI and Studio render actionable messages.

## Archive + filesystem I/O

- `unpack(input: Uint8Array): Bundle` — gunzip + untar into the file map. Throws
  `BundleFormatError` if no `uniqent.json`.
- `pack(bundle, opts?): Uint8Array` — runs `validateBundle` + secret-scan unless
  `opts.skipValidation`; tars (entries sorted, fixed mtime/mode for reproducibility) + gzips.
  Reproducible packing is a convenience; correctness of the digest does not depend on it.
- `readDir(path): Promise<Bundle>` / `writeDir(bundle, path): Promise<void>` — directory ⇄ Bundle,
  for `init`/`inspect`/`export` flows in later milestones.

## Dependencies

- `@uniqent/spec` (workspace) — all schemas.
- `@noble/ed25519` — signing.
- A Node tar library (e.g. `tar` or `tar-stream`) — archive; `node:zlib` for gzip; `node:crypto`
  for sha256.

## Testing (TDD — tests precede implementation)

- **digest:** identical content → identical digest; insertion-order independent; one byte change →
  different digest; `signature.json` excluded.
- **secret-scan:** detects each prefix type, PEM block, and a high-entropy token; allows
  `${credentialRef:…}` and `author.pubkey`; skips `signature.json`; `pack`/`sign` throw
  `SecretScanError` on a planted secret.
- **sign/verify:** sign → verify `valid:true`; tamper a file → `valid:false`; unsigned →
  `signed:false`; verify with a mismatched key → `valid:false`.
- **round-trip:** `unpack(pack(b))` preserves `canonicalDigest` (the headline M1 acceptance).
- **validate:** the `dev-powerpack` example (expanded to a full bundle fixture) validates; a dangling
  `credentialRef` → error; a missing `SKILL.md` → error.
- **spec:** `MemoryItem` accepts/defaults `visibility`; JSON Schema drift test still passes after
  regeneration.

## Acceptance (M1)

- Round-trip pack/unpack is byte-stable for the content digest.
- `validate`/`pack` reject a bundle with an embedded fake `sk-…` key (secret-scan throws / errors).
- Tampering with any file after `sign` makes `verify` fail.
- `MemoryItem.visibility` added to the spec; JSON Schema + `SPEC.md` regenerated; drift test green.
- `pnpm build`, `typecheck`, `lint`, `test` all pass.
