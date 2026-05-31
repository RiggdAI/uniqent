# Security Policy

Trust is a first-class feature of Uniqent, not an afterthought. This document covers both how the
toolchain protects users and how to report vulnerabilities.

## Built-in protections

- **Secret-scan gate (fail-closed).** `pack`, `validate`, and `sign` run `scanForSecrets()` over
  every file in a bundle, using entropy heuristics plus known key prefixes (`sk-`, `ghp_`,
  `xoxb-`, …). Any likely secret value fails the operation. Secrets are never permitted in a
  bundle — only credential _references_ and install-time resolution.
- **Signing & verification.** Bundles are signed with Ed25519 over a canonical digest of their
  contents. `verify` fails if any file changed after signing. Installing an unsigned or
  unverifiable bundle requires an explicit `--allow-unsigned` flag and prints a loud warning.
- **Permission sheet + memory preview.** Before any write, install shows the requested filesystem,
  network, autonomy, and process-spawn scopes, and lets the user redact or skip memory items.
- **Sandboxed dry-run.** Install loads the agent in a sandbox and confirms tools/MCP/persona/memory
  before `apply()` writes anything to the real framework.
- **Skill script static scan.** `validate` statically flags skill scripts that shell out, make
  network calls, or look obfuscated (warning in v1; blocking on registry publish later).

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than opening a public issue. Email the
maintainers (see repository metadata) with a description, reproduction steps, and impact. We aim to
acknowledge within a few business days and will coordinate a fix and disclosure timeline with you.

Do not include real secrets or credentials in reports or test bundles.
