# UX review — capture flow + CLI (dogfooding notes)

Written while building `uniqent export` and running the full author → pack → install → capture loop.
The goal of this doc: be honest about what works, what's confusing, and what to fix next. Findings
are ordered by impact.

## What I built this round: `uniqent export` (capture an existing agent → a brain)

`uniqent export [--from <claude-code|hermes|openclaw>] --root <dir> [-o <file>]` reverses install:
it reads a framework's native files back into a `.uniqent`. `--from` is optional — it auto-detects
from marker files (`.claude/`/`.mcp.json`, `hermes.json`, `openclaw.json`).

**Why it matters:** most people already _have_ an agent. "Capture what I already built" is a bigger
on-ramp than "build from scratch in Studio." This is the Docker `commit` to install's `run`.

**Verdict:** the flow makes sense and works end to end (install a brain with a token → export the
project → the captured brain re-installs). One real bug found and fixed while testing:

- **FIXED — silent loss of credential wiring on capture.** Claude Code's `export()` set every MCP
  server to `auth: none` and never looked at the `Authorization` header. Result: a captured brain
  was _safe_ (no secret leaked) but **non-functional** — it wouldn't prompt for, or use, the token
  on re-install, and said nothing about it (violates "lossy is OK, silent loss is not"). Now
  `export()` recovers the credential _requirement_ (`auth: bearer` + a `CredentialRequirement`)
  from the header **without reading its value**, and the export output lists "credentials to
  re-supply on install." Verified: captured brain lists `github_token`, the secret value is absent
  from the bytes, and `scanForSecrets` is clean.

### Remaining gaps in capture (ordered)

| Gap                                                                                            | Impact                                                             | Recommendation                                                                                                  |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Captured brain is always named `captured-agent` / "Captured Agent", `v0.1.0`, author `unknown` | Unshareable as-is; user must hand-edit                             | Derive the name from the dir; add `--name`/`--author` (extend `ExportOptions`) or prompt                        |
| `stdio` MCP `env` is dropped entirely on capture                                               | Loses config (e.g. filesystem root) and any secret env             | Capture `env`; scrub secret-looking values to `${credentialRef}` using the existing secret-scan heuristic       |
| Memory / channels / tasks can't be recaptured from Claude Code                                 | Round-trip through a lossy target loses them                       | Document that capture fidelity is bounded by what the source stores; capture from Hermes/OpenClaw recovers more |
| `adapter.detect()` is a stub (`present: true` always)                                          | CLI re-implements marker detection instead of trusting the adapter | Make each `detect()` actually probe markers; have `export` use it                                               |
| The recovered credential ref is regenerated (`github_token`, not the original `github_pat`)    | Cosmetic; ref name differs from source                             | Acceptable; note in output                                                                                      |

## Cross-cutting CLI / flow UX (from dogfooding the whole loop)

| #   | Finding                                                                                                                                 | Impact                                                                      | Recommendation                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | **No `uniqent sign` / `keygen`.** Examples are signed by an ad-hoc script; users can't sign their own brains. `export` writes unsigned. | The trust story (signing is "v1, first-class") isn't reachable from the CLI | Add `uniqent keygen` + `uniqent sign <file> --key <k>` + `export --sign`. **High.**           |
| 2   | **No `install --dry-run`.** The design promises a sandboxed dry-run; the CLI applies after showing the plan but has no plan-only flag.  | Users can't preview writes/lossiness without committing                     | Add `install --dry-run` (print plan + lossiness + required creds, write nothing). **High.**   |
| 3   | **`install` always needs `--target`.**                                                                                                  | Friction; the recipient often has exactly one framework                     | Auto-detect the target from `--root` (reuse `detect`) and default to it; `--target` overrides |
| 4   | **Credentials are one `--cred ref=val` each.**                                                                                          | Tedious for multi-cred brains                                               | Add `--cred-file <env>`; confirm interactive TTY prompting works in the real `bin`            |
| 5   | **No `uniqent init`.** Authoring from the terminal isn't possible (Studio-only).                                                        | Power users / CI can't scaffold a brain                                     | Add `uniqent init <name>` to scaffold a canonical brain dir                                   |
| 6   | **One-click install isn't one-click yet.** Install is a CLI command or the Studio button; there's no `uniqent://` web handoff.          | The "anyone installs instantly" (Docker-pull) promise is unmet              | Build the `uniqent://install?bundle=<url>` handler + the uniqent.ai Install button            |
| 7   | Generic captured-brain metadata (see above) + no post-capture edit step                                                                 | Captured brains need hand-editing before sharing                            | A short interactive "name/author/tags?" prompt after capture, or pipe capture → Studio        |

## Top 3 to do next

1. ~~**`uniqent sign` + `keygen`**~~ — **DONE.** `uniqent keygen` writes a hex keypair; `uniqent sign
<file> --key <k>` signs in place; `pack`/`export` take `--key` (stable identity) or `--sign`
   (ephemeral, integrity-only). A validly-signed brain now installs without `--allow-unsigned`.
2. ~~**`install --dry-run`**~~ — **DONE.** Prints the plan + lossiness + required credentials and
   writes nothing.
3. **`uniqent://` one-click web install** — closes the gap between the "Docker for brains" pitch and
   the actual install friction (#6). Still open.

## What's genuinely good (don't regress)

- `install` reports **lossiness** honestly and is **idempotent**; the secret-scan gate is
  fail-closed; memory renders clean (no `[[wiki]]` leak) — these are the trust differentiators.
- Auto-detect in `export` and the rich capture report read well.
- `search` / `hub` / install-by-slug against a registry (incl. the hosted uniqent.ai) work with zero
  CLI changes — the open format is paying off.
