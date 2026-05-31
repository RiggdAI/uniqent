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

# Pack it into a signed-able .uniqent
node packages/cli/dist/bin.js pack examples/dev-powerpack -o /tmp/dev-powerpack.uniqent

# Install into a framework (resolves credentials locally; prompts if omitted)
node packages/cli/dist/bin.js install /tmp/dev-powerpack.uniqent \
  --target claude-code --root /path/to/project --cred github_pat=YOUR_TOKEN

# install also accepts a raw URL — no registry required:
node packages/cli/dist/bin.js install https://example.com/dev-powerpack.uniqent --target hermes --root .
```

These are generated from `@uniqent/builder`, so they always validate; regenerate by editing the
builder and re-authoring. Or build your own in **Uniqent Studio** (`pnpm --filter @uniqent/studio start`).
