# Example brains

Each subdirectory is a `.uniqent` brain in its **canonical (unpacked) layout** — the same files
that go inside a packed `.uniqent` (a gzipped tar). They carry **no secrets**; MCP servers and
channels declare credential _requirements_ that the installer resolves locally.

| Example                                     | What it is                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`dev-powerpack/`](dev-powerpack)           | Coding agent — GitHub + filesystem + web MCP, code-review & release-notes skills, a daily-standup flow. |
| [`research-analyst/`](research-analyst)     | Web-research agent — fetch MCP, a faithful-citation summarize skill.                                    |
| [`personal-assistant/`](personal-assistant) | Telegram-reachable assistant — filesystem MCP, a user profile, and a daily-briefing flow.               |

## Try one

From the repo root (after `pnpm build`):

```bash
# Validate the canonical source
node packages/cli/dist/bin.js validate examples/dev-powerpack

# Pack it into a signed .uniqent (--sign uses an ephemeral key; use --key <keyfile> from
# `uniqent keygen` for a stable publisher identity). Install refuses unsigned bundles unless you
# pass --allow-unsigned.
node packages/cli/dist/bin.js pack examples/dev-powerpack --sign -o /tmp/dev-powerpack.uniqent

# Preview exactly what would be written (files, MCP commands/URLs, lossiness) — writes nothing
node packages/cli/dist/bin.js install /tmp/dev-powerpack.uniqent \
  --target claude-code --root /path/to/project --dry-run

# Install into a framework (credentials resolve locally: --cred, UNIQENT_CRED_<REF>, or a hidden
# prompt on an interactive terminal; --yes skips the confirmation, required when not on a TTY)
node packages/cli/dist/bin.js install /tmp/dev-powerpack.uniqent \
  --target claude-code --root /path/to/project --cred github_pat=YOUR_TOKEN --yes

# install also accepts a raw https URL — no registry required (--root is the Hermes home):
node packages/cli/dist/bin.js install https://example.com/dev-powerpack.uniqent --target hermes --root ~/.hermes
```

These are generated from `@uniqent/builder`, so they always validate; regenerate by editing the
builder and re-authoring. Or build your own in **Uniqent Studio**
(`pnpm --filter @uniqent/studio build && pnpm --filter @uniqent/studio start`).

## Memory sample

[`memory-sample.md`](memory-sample.md) is a markdown memory file using `[[entities]]` and `#tags`.
Paste or upload it into Studio's **Memory → Smart import** to see it parse into kinds
(Decision/Preference/Milestone/…) and wire up into the **Memory brain** graph (the 🧠 button).
