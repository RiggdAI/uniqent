# @uniqent/cli

> The `uniqent` CLI — build, package, and install portable AI-agent brains (`.uniqent` bundles).

Part of **[Uniqent](https://github.com/RiggdAI/uniqent)** — _any brain, any agent_: package an AI agent's whole brain (persona, MCP stack, skills, memory, config) into one open, signed `.uniqent` file and install it into whatever framework you run (Claude Code, Hermes, OpenClaw).

## Try it in one command

```bash
npx @uniqent/cli try research-analyst
```

Auto-detects your framework, installs a signed, creds-free research brain (no API key), and tells you exactly what to ask. `npx @uniqent/cli try --list` browses featured brains.

## Install

```bash
npm i -g @uniqent/cli      # or use: npx @uniqent/cli <command>
```

## Commands

| Command                                | Description                                                                                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `try <brain>`                          | One-command install of a featured brain — auto-detects your agent framework and prints a suggested first prompt. Pass `--list` to browse featured brains. |
| `install <file\|url\|slug>`            | Install a `.uniqent` bundle into a target framework directory. Accepts a local file, a raw HTTPS URL, or a registry slug.                                 |
| `inspect <file\|url\|slug>`            | Print a bundle's identity, components, permissions, credential requirements, and signature status — without installing it.                                |
| `validate <dir\|file>`                 | Validate a bundle directory or packed `.uniqent` file against the canonical schema and report errors.                                                     |
| `pack <dir>`                           | Pack a canonical bundle directory into a `.uniqent` file; validates and secret-scans before writing.                                                      |
| `search <query>`                       | Search a registry index (`--registry <url>` or `UNIQENT_REGISTRY`) and list matching bundles.                                                             |
| `hub <mcp\|skills> <query>`            | Search MCP server hubs (MCP Registry, Smithery) or skill hubs (GitHub) for servers and skills to add to a brain.                                          |
| `export`                               | Capture an existing framework setup (Claude Code, Hermes, or OpenClaw) back into a canonical `.uniqent` bundle, scrubbing secrets to credential refs.     |
| `import-vault <dir>`                   | Capture an Obsidian / second-brain vault folder (markdown notes, `[[links]]`, `#tags`) into a signed `.uniqent` bundle.                                   |
| `publish-memory <pack.json\|notes.md>` | Publish a memory pack to a hosted hub (default `uniqent.ai`). Accepts a structured `.json` pack or freeform markdown.                                     |
| `keygen`                               | Generate an Ed25519 keypair for signing bundles. Writes a `uniqent.key.json` file — keep it out of git.                                                   |
| `sign <file.uniqent>`                  | Sign a packed bundle with a keypair written by `keygen`.                                                                                                  |

## Publishing (requires login)

Publishing is per-user. Create a token at <https://uniqent.ai/account/tokens>, then:

```bash
uniqent login                 # paste your token (stored in ~/.uniqent/credentials.json)
uniqent publish ./my-brain    # packs (optionally --sign) and uploads the .uniqent
uniqent publish-memory notes.md --slug team-playbook --name "Team playbook"
uniqent logout
```

Token resolution order: `--token` flag → `UNIQENT_PUBLISH_TOKEN` env → stored login.
`uniqent publish` accepts a packed `.uniqent` file or a directory (packed on the fly;
add `--sign` or `--key <file>` to sign). The registry rejects unsigned/secret-bearing
bundles, and a name owned by another publisher returns a conflict.

## A few flows

**Try a featured brain (zero config):**

```bash
npx @uniqent/cli try research-analyst
# auto-detects Claude Code / Hermes / OpenClaw, installs, prints a suggested prompt
npx @uniqent/cli try --list
# browse all featured brains
```

**Install a signed bundle with credentials:**

```bash
uniqent install my-brain.uniqent \
  --target claude-code \
  --root ~/my-project \
  --cred OPENAI_API_KEY=sk-... \
  --yes
```

**Install directly from a URL (no registry needed):**

```bash
uniqent install https://example.com/brains/dev-powerpack.uniqent \
  --target hermes \
  --root ~/hermes-home \
  --allow-unsigned
```

**Pack, sign, and inspect a bundle:**

```bash
uniqent keygen -o publisher.key.json
uniqent pack ./my-brain-dir --sign --key publisher.key.json -o my-brain.uniqent
uniqent inspect my-brain.uniqent
```

**Export an existing Claude Code setup into a portable bundle:**

```bash
uniqent export --from claude-code --root ~/my-project -o my-brain.uniqent
```

**Import an Obsidian vault:**

```bash
uniqent import-vault ~/Documents/MyVault --name "My Knowledge Brain" --sign --key publisher.key.json
```

## Where this fits

The CLI is a thin front-end over [`@uniqent/builder`](https://www.npmjs.com/package/@uniqent/builder) + [`@uniqent/core`](https://www.npmjs.com/package/@uniqent/core) and the framework adapters (`@uniqent/adapter-claude-code`, `@uniqent/adapter-hermes`, `@uniqent/adapter-openclaw`). The same logic powers Uniqent Studio. **Secrets never travel in a bundle** — the installer resolves your own credentials locally into the target framework's native credential store.

## License

Apache-2.0. The `.uniqent` spec text/schema is CC0. See the [Uniqent monorepo](https://github.com/RiggdAI/uniqent).
