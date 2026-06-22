# CLI auth: `uniqent login` + `uniqent publish` + polish

**Date:** 2026-06-21
**Repo:** `uniqent` (monorepo) — branch `feat/cli-auth-publish`
**Status:** Approved design

## Problem

The registry (uniqent.ai) now requires per-user auth to publish: tokens are
minted at `/account/tokens` and sent as `Authorization: Bearer unq_live_…`; the
server resolves them to a publisher and records ownership. The CLI
(`@uniqent/cli`) has not been updated for this:

- It has **no stored-credential flow** — `publish-memory` requires `--token` or
  `UNIQENT_PUBLISH_TOKEN` on every call (the old shared-token UX).
- It has **no brain `publish` command** at all — `.uniqent` bundles can only be
  pushed by a script in the registry repo, not via the CLI.
- Help text and the README still describe the shared token.

Because `publish-memory` already sends the token as a Bearer header, a minted
`unq_live_…` token already works when passed via `--token`. The gap is the
npm-style ergonomics (`login` once, then publish) and the missing brain publish.

## Decisions (from brainstorming)

- Scope: **login + publish + polish** (full parity).
- Credential file: **`~/.uniqent/credentials.json`** (mode `0600`), per-registry.
- `uniqent publish` **accepts a directory** (packs it on the fly) or a `.uniqent` file.
- Include **`uniqent logout`**.
- Paste-token login only (no OAuth/device flow). No server `whoami` (none exists yet).

## Architecture

### 1. Credential store — `packages/cli/src/credentials.ts` (new)

- File: `join(homedir(), '.uniqent', 'credentials.json')`, written with mode `0600`,
  directory created if absent. Shape:
  ```json
  { "https://uniqent.ai": { "token": "unq_live_…" } }
  ```
  Keyed by the normalized registry base URL so a custom `--registry` keeps its own token.
- Exports:
  - `loadToken(registry: string): Promise<string | undefined>`
  - `saveToken(registry: string, token: string): Promise<void>`
  - `clearToken(registry: string): Promise<boolean>` (returns whether one was removed)
  - `resolveToken(opts: { flag?: string | true; registry: string }): Promise<string | undefined>`
    — precedence: **`flag` (if a string) → `process.env.UNIQENT_PUBLISH_TOKEN` → stored token**.
- Registry-base normalization reuses the same rule the builder's `base()` uses
  (strip trailing slash); the credential key is that normalized base.
- All reads degrade: a missing/corrupt file yields `undefined`, never throws.

### 2. `uniqent login` / `uniqent logout` — in `packages/cli/src/run.ts`

- `loginCmd(args, io)`:
  - registry = `--registry` or `DEFAULT_HUB` (`https://uniqent.ai`).
  - token = `--token` if a string; else if `io.prompt` is available, prompt
    `Paste a publish token (create one at <registry>/account/tokens): `; else
    error `login: provide --token <t> (non-interactive)` → exit 1.
  - `saveToken(registry, token)`; log `Saved token for <registry>.` → exit 0.
- `logoutCmd(args, io)`:
  - `clearToken(registry)`; log `Logged out of <registry>.` or `No token stored for <registry>.` → exit 0.

### 3. `uniqent publish <file.uniqent|dir>` — `run.ts` + builder helper

- New `publishBundle(registry, token, bytes, signal?)` in
  `packages/builder/src/hubs/bundle-hub.ts` (sibling of `publishMemoryPack`),
  exported from the builder barrel:
  - POST `bytes` to `${base(registry)}/api/v1/bundles` with headers
    `{ 'content-type': 'application/octet-stream', authorization: 'Bearer ' + token }`.
  - Parse JSON; on `!res.ok` throw `Error(json.error ?? '<status> <statusText>')`.
  - Return `{ ok, name, version, url, signed, persisted }` (mirrors the server response).
- `publishCmd(args, io)`:
  - positional = bundle path. Missing → error, exit 1.
  - Resolve bytes: a directory → `pack` it (reuse the existing pack path, threading
    `--sign`/`--key`/`--cred` flags), a file → read bytes from disk.
  - `token = await resolveToken({ flag: flags.token, registry })`; if none →
    error `publish: not logged in — run \`uniqent login\` or pass --token` → exit 1.
  - Call `publishBundle`; on success log
    `published <name>@<version>${signed ? ' (signed)' : ''}${persisted === false ? ' (stored, not indexed)' : ''}`.
  - Map thrown server errors to actionable messages:
    - message contains `unauthorized` / status 401 → append `— run \`uniqent login\``.
    - `namespace owned by another publisher` (409) → surface as-is.
    - trust-gate reason (422, e.g. unsigned/secret) → surface as-is, hint
      `pack and sign it: \`uniqent pack <dir> --sign\``.

### 4. `publish-memory` update + polish

- Replace its token lookup with
  `await resolveToken({ flag: flags.token, registry })`; on none, error
  `publish-memory: not logged in — run \`uniqent login\` or pass --token`.
- Behavior otherwise unchanged (it already sends Bearer via `publishMemoryPack`).
- Update the usage/help string to include `login`, `logout`, `publish`.
- Update `packages/cli/README.md` publish section: document `uniqent login`,
  `uniqent publish <dir|file>`, and that tokens come from `/account/tokens`.

### 5. Command dispatch

- In the dispatcher in `run.ts`, add: `login → loginCmd`, `logout → logoutCmd`,
  `publish → publishCmd`. Keep all existing commands unchanged.

## Data flow

`uniqent login` → prompt/flag token → `saveToken` → `~/.uniqent/credentials.json`.
`uniqent publish <dir>` → pack(+sign) → `resolveToken` (flag→env→stored) →
`publishBundle` → `POST /api/v1/bundles` (Bearer) → server trust-gate + ownership →
`{ name, version, … }` or error → mapped CLI message.

## Error handling

- No token on publish/publish-memory → exit 1 with a "run `uniqent login`" hint.
- Server 401 → same hint; 409 → ownership message; 422 → trust-gate reason + sign hint.
- Corrupt/missing credentials file → treated as "no stored token", never a crash.
- Non-interactive `login` without `--token` → clear error, exit 1.

## Testing (TDD — Vitest is configured: `test/**/*.test.ts`)

- `test/credentials.test.ts`: `saveToken`→`loadToken` round-trip and `clearToken`,
  using a temp `HOME`/dir; `resolveToken` precedence (flag > env > stored > none);
  corrupt-file → `undefined`.
- `test/publish.test.ts`: with a stubbed global `fetch` and an injected `CliIo`:
  - `publishCmd` sends `Authorization: Bearer <token>` and the bundle bytes; logs the
    success line on a 200.
  - 401/409/422 responses map to the specified messages and exit code 1.
  - `loginCmd` with `--token` writes the credential (assert via `loadToken`).
- `packages/builder/test/bundle-hub.test.ts`: `publishBundle` posts to the right URL
  with the Bearer header and returns the parsed result / throws the server error.
- Gate: `pnpm --filter @uniqent/cli --filter @uniqent/builder build` (tsc) +
  `pnpm --filter @uniqent/cli --filter @uniqent/builder test` green.

## Out of scope

- OAuth / device-flow login (paste-token only).
- A server `whoami`/token-verify endpoint (login stores without verifying; a future
  server addition can let `login` confirm the token).
- Changes to install/search/inspect/pack internals beyond what `publish` reuses.
- Publishing the updated CLI to npm (release is a separate step).
