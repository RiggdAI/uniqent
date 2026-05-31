# M4 — Adapter SDK + Claude Code Adapter + Install Design

**Date:** 2026-05-31
**Status:** Approved (brainstorm) — pending implementation plan
**Milestone:** M4 (Claude Code adapter + CLI install; OpenClaw + Studio install are M4b)

## Purpose

Close the loop: an exported `.uniqent` actually **installs into Claude Code**. Build the adapter
contract (the moat), the Claude Code translation, and a thin CLI that verifies → plans → resolves
credentials locally → applies. Prove it by installing a real exported brain into a sandbox.

## Packages

- **`packages/adapter-sdk`** (`@uniqent/adapter-sdk`) — depends on `@uniqent/core`.
  - The `Adapter` interface + shared types.
  - A **conformance harness**: given an adapter + a bundle + a sandbox root, run `plan → apply →
apply` and assert (a) `apply` is idempotent (identical file tree on the 2nd run), (b) **no secret
    values written to disk**, (c) every bundle component the target can't represent appears in
    `plan.lossiness`.
- **`packages/adapter-claude-code`** (`@uniqent/adapter-claude-code`) — `detect/plan/apply/export`.
- **`packages/cli`** (`uniqent`) — `inspect <file>` and `install <file> --target claude-code --root <dir>`,
  over `core` + the adapter. Hand-rolled arg parsing (no new dep); logic in a testable `run(argv)`.

## Adapter interface (`adapter-sdk`)

```ts
interface Adapter {
  id: string;                       // 'claude-code'
  displayName: string;
  detect(opts: { root?: string }): Promise<{ present: boolean; version?: string; configRoot?: string }>;
  plan(bundle: Bundle, opts: InstallOptions): Promise<InstallPlan>;          // no writes
  apply(bundle: Bundle, plan: InstallPlan, resolved: ResolvedCredentials, opts: InstallOptions): Promise<InstallResult>;
  export(opts: { root: string }): Promise<Bundle>;                           // native → canonical
}
InstallOptions = { root: string };                                           // project root (parent of .claude)
InstallPlan = {
  writes: Array<{ path: string; summary: string }>;
  mcpRegistrations: string[];
  channelRegistrations: string[];
  lossiness: Array<{ component: string; issue: string; action: 'truncated' | 'dropped' | 'transformed' }>;
  requiresCredentials: string[];    // credential refs that must be resolved before apply()
};
ResolvedCredentials = Record<string, string>;
InstallResult = { written: string[]; notes: string[] };
```

## Claude Code mapping

`root` is the project root (the dir that contains `.claude/`).

| Bundle                                          | → path under `root`                      | Action                       |
| ----------------------------------------------- | ---------------------------------------- | ---------------------------- |
| `skills/<name>/…`                               | `.claude/skills/<name>/…`                | copy verbatim                |
| `identity/persona.md` (+ `policies.md`, memory) | `AGENTS.md` (adapter-owned, overwritten) | transformed                  |
| `mcp/servers.json`                              | merged into `.mcp.json` `mcpServers`     | remap + credential injection |
| `channels`, `tasks`, `tools`                    | —                                        | dropped → `lossiness`        |
| `memory/*`                                      | folded into `AGENTS.md` (structure lost) | transformed → `lossiness`    |

**`.mcp.json` entry shapes:** stdio → `{ command, args, env }`; `streamable-http` → `{ type: 'http', url, headers }`; `sse` → `{ type: 'sse', url, headers }`. Credentials inject at apply: `auth.bearer` → `headers.Authorization = "Bearer <resolved>"`; `auth.header` → `headers[headerName] = <resolved>`; `${credentialRef:ref}` placeholders in `env` → resolved value.

**`requiresCredentials`** = manifest credentials consumed by an installed MCP server (channel creds drop with channels).

## Correctness commitments

- **AGENTS.md is adapter-owned** → written in full, deterministically (idempotent by construction). If a pre-existing `AGENTS.md` is present, `apply` overwrites it and notes this in `result.notes`.
- **`.mcp.json` merges** — existing user servers preserved; bundle servers added/replaced by id. Re-running yields the same file (idempotent).
- **Secrets never on disk except as the user's resolved values in `.mcp.json`** (which is where Claude Code expects them). The bundle itself carries none; `plan`/`apply` never copy secret material out of the bundle (there is none).

## CLI

```
uniqent inspect <file.uniqent>
  → unpack + verify signature; print manifest summary, permissions, credential requirements, signature status.

uniqent install <file.uniqent> --target claude-code --root <dir> [--cred ref=value]... [--allow-unsigned] [--yes]
  → unpack → verify (loud warn if unsigned; refuse unless --allow-unsigned)
  → adapter.plan() → print permission sheet + lossiness; confirm unless --yes
  → resolve requiresCredentials from --cred / env (UNIQENT_CRED_<REF>) / interactive prompt
  → adapter.apply() → print written files + how to launch.
```

## Testing

- **adapter-claude-code unit:** `plan` lists expected writes + `requiresCredentials` + lossiness (channels/tasks/tools dropped, memory transformed); `apply` into a tmp root copies skills, writes `AGENTS.md` with the persona, and a `.mcp.json` whose server has the **injected** credential; a 2nd `apply` is byte-identical; **no secret patterns** in any written file.
- **conformance:** `runConformance(claudeCodeAdapter, bundle, tmp)` passes.
- **cli:** `run(['install', file, '--target', 'claude-code', '--root', tmp, '--cred', 'github_pat=ghp_…'])` installs; `run(['inspect', file])` prints a summary. Tested against a real packed bundle.

## Acceptance (M4)

- A real exported `.uniqent` installs into a sandbox `<tmp>/.claude/` + `<tmp>/AGENTS.md` + `<tmp>/.mcp.json`; skills present, persona in AGENTS.md, MCP server registered with the resolved credential, **zero secret material from the bundle on disk**, lossiness reported, 2nd run idempotent.
- Conformance harness passes; `pnpm build/typecheck/lint/test` green.
