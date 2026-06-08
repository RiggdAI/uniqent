# @uniqent/core

> Read, validate, sign, and pack `.uniqent` agent-brain bundles. Framework-agnostic.

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain into one open, signed `.uniqent` file and install it into whatever framework you run.

## What it does

- **Read / write** a bundle directory or gzipped-tar archive — `readDir`, `writeDir`, `pack`, `unpack`.
- **In-memory bundle model** — `Bundle` class with typed accessors for every bundle component (manifest, persona, memory, MCP servers, skills, channels, tasks, tools, runtime config).
- **Validate** against the [`@uniqent/spec`](https://www.npmjs.com/package/@uniqent/spec) schema — `validateBundle` returns a structured result; `assertValid` throws on failure.
- **Secret-scan gate** — fail-closed: `scanForSecrets` detects likely secrets anywhere in a bundle (known prefixes like `sk-`, `ghp_`, `xoxb-`, `AKIA…`, private-key headers, plus high-entropy tokens). `pack` and `sign` both run this gate automatically; a hit throws `SecretScanError` and the operation is aborted.
- **Sign / verify** — Ed25519 over a `canonicalDigest` of the bundle contents. `generateKeypair` creates a hex-encoded keypair; `sign` attaches a `signature.json`; `verify` confirms it.
- **Credential-ref helpers** — `findCredentialRefs` / `resolvePlaceholders` handle the `${credentialRef:<ref>}` placeholder pattern that keeps real secrets out of bundles.

## Install

```bash
npm install @uniqent/core
```

## Usage

```ts
import {
  readDir,
  validateBundle,
  generateKeypair,
  sign,
  pack,
  unpack,
  verify,
} from '@uniqent/core';

// 1. Load a bundle from an exploded directory (must contain uniqent.json at root).
const bundle = await readDir('./my-brain');

// 2. Validate against the spec schema; returns { ok, errors, warnings }.
const result = validateBundle(bundle);
if (!result.ok) {
  console.error('Validation errors:', result.errors);
  process.exit(1);
}

// 3. Generate a signing keypair (store privateKey somewhere safe — never in the bundle).
const { privateKey, publicKey } = await generateKeypair();
console.log('Public key:', publicKey);

// 4. Sign the bundle. Runs the secret-scan gate first; throws SecretScanError on a hit.
//    Returns a new Bundle with signature.json attached.
const signed = await sign(bundle, privateKey);

// 5. Pack to a gzipped tar (Uint8Array) — also runs the secret-scan gate.
const bytes = await pack(signed);

// 6. Later: unpack and verify the signature.
const restored = await unpack(bytes);
const { signed: isSigned, valid } = await verify(restored);
console.log('Signed:', isSigned, '| Valid:', valid);
```

## API surface

| Export                                 | Description                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `Bundle`                               | In-memory bundle model with typed accessors (`manifest()`, `persona()`, `memoryFacts()`, `mcpServers()`, `skillNames()`, …) |
| `readDir(dir)`                         | Read an exploded bundle directory into a `Bundle`                                                                           |
| `writeDir(bundle, dir)`                | Write a `Bundle` back out to a directory                                                                                    |
| `pack(bundle, opts?)`                  | Secret-scan + validate → gzipped tar `Uint8Array`                                                                           |
| `unpack(bytes)`                        | Gunzip + untar → `Bundle`                                                                                                   |
| `validateBundle(bundle)`               | Full schema + layout + credential-ref check → `ValidationResult`                                                            |
| `assertValid(bundle)`                  | Like `validateBundle` but throws `BundleValidationError` on failure                                                         |
| `scanForSecrets(bundle)`               | Returns `SecretFinding[]`; empty means clean                                                                                |
| `canonicalDigest(bundle)`              | Deterministic SHA-256 over all files except `signature.json`                                                                |
| `generateKeypair()`                    | Ed25519 keypair as hex strings `{ privateKey, publicKey }`                                                                  |
| `sign(bundle, privateKeyHex)`          | Secret-scan + sign → new `Bundle` with `signature.json`                                                                     |
| `verify(bundle)`                       | Ed25519 verify → `VerifyResult { signed, valid, reason?, publicKey? }`                                                      |
| `findCredentialRefs(bundle)`           | Find all `${credentialRef:<ref>}` placeholders                                                                              |
| `resolvePlaceholders(value, resolved)` | Substitute placeholders with real values                                                                                    |
| `PATHS`                                | Canonical path constants (`uniqent.json`, `identity/persona.md`, …)                                                         |
| `BundleFormatError`                    | Thrown when archive structure or JSON is malformed                                                                          |
| `BundleValidationError`                | Thrown by `assertValid`; carries `issues` array                                                                             |
| `SecretScanError`                      | Thrown by `pack`/`sign` when secrets are detected; carries `findings` array                                                 |

## Secret-scan gate

The gate is fail-closed: it runs automatically on `pack` and `sign`, with no opt-out. Detected patterns include OpenAI keys (`sk-…`), GitHub PATs (`ghp_`, `ghs_`, …), Slack tokens (`xoxb-…`), AWS access keys (`AKIA…`), PEM private-key headers, and generic high-entropy tokens ≥ 32 characters with a long unbroken run. `${credentialRef:<ref>}` placeholders and known-public-key fields are explicitly allowed.

## Where this fits

The foundation under [`@uniqent/builder`](https://www.npmjs.com/package/@uniqent/builder), all framework adapters (`@uniqent/adapter-claude-code`, `@uniqent/adapter-hermes`, `@uniqent/adapter-openclaw`), and the [`@uniqent/cli`](https://www.npmjs.com/package/@uniqent/cli). Depends only on [`@uniqent/spec`](https://www.npmjs.com/package/@uniqent/spec), `@noble/ed25519`, and `tar-stream`.

## License

Apache-2.0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
