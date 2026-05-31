# M3 — Uniqent Studio (`apps/studio`) Design

**Date:** 2026-05-31
**Status:** Approved (brainstorm) — pending implementation plan
**Milestone:** M3 (see `docs/BUILD_PLAN.md` §6) — the priority deliverable.

## Purpose

Uniqent Studio is the local-first visual builder: the browsable product. A local Node server
exposes a JSON API over `@uniqent/builder` and serves a React + Vite SPA. A user composes a brain
from scratch and exports a signed `.uniqent` — no hand-editing. Nothing leaves the machine; secrets
are entered locally only at export. The UI duplicates no logic — every mutation goes through the
builder/core engine.

## Architecture

```
apps/studio/
  package.json              # @uniqent/studio; scripts: dev, build, start, test
  tsconfig.json             # server (Node)
  src/server/
    session.ts              # StudioSession: wraps a Brain; state(), apply actions, export()
    api.ts                  # createApiHandler(session): maps HTTP requests to session methods
    index.ts                # http server: serves API under /api + static web/dist
  src/server/*.test.ts      # StudioSession + api unit tests (no browser)
  web/
    index.html
    vite.config.ts          # base './', build outDir ../dist-web, dev proxy /api -> server
    tsconfig.json           # DOM + react-jsx
    src/main.tsx, App.tsx, api.ts, panels/*, styles.css
```

- **`StudioSession`** (testable core of the server) holds one in-memory `Brain` and exposes:
  `state()` → `{ manifestPreview, validation, components }`; `setMeta`, `setPersona`, `addFact`,
  `addMcpFromCatalog`, `addSkillFromCatalog`, `reset`; `catalog()` → MCP + skill catalogs;
  `export({ sign })` → `{ filename, bytesBase64, validation, signed }` (packs via core; optional
  Ed25519 sign with a session keypair; server-side verifies before returning).
- **`api.ts`** is a thin request→session map (pure function of `(method, path, body)`), unit-testable
  without a socket.
- **`index.ts`** binds it to `node:http`, serves `web` build output for non-`/api` routes.

## UI

A left sidebar selects a panel; a live status bar shows validation/secret/credential state.

- **Identity** — persona markdown textarea → `setPersona`.
- **Stack** — MCP catalog list with **Add**; shows added servers + their credential requirement.
- **Skills** — skill catalog list with **Add**; shows added skills.
- **Memory** — add a fact (text + importance) → facts list.
- **Config** — meta form (name, displayName, version, description, author, license, tags, targets).
- **Review** — live validation result, the derived **permission sheet**, **credential requirements**,
  and **secret-scan status** (0 secrets).
- **Export** — pack (+ optional sign) → downloads `<name>.uniqent`.

## Testing

**Server unit tests (vitest, no browser):**

- A fresh session is invalid until meta+persona set; becomes valid after adding meta, persona,
  a catalog MCP, and a skill.
- `addMcpFromCatalog('github')` surfaces the `github_pat` credential requirement in `state()`.
- `export()` returns bytes that `core.unpack` + `validateBundle` accept; with `sign:true`,
  `core.verify` returns `{ signed:true, valid:true }`.
- `api.ts` routes map correctly (GET /api/state, POST /api/mcp/catalog/github, POST /api/export, …).

**Live browser e2e (the M3 acceptance gate):** build `web`, start the server, drive a real
(non-headless) browser, screenshot each step: set meta → persona → add GitHub MCP → add a skill →
add a fact → Review shows valid + `github_pat` required + 0 secrets → Export. Then assert the
downloaded `.uniqent` passes `core.validateBundle` and is signed. Screenshots captured as evidence.

## Acceptance (M3)

- With zero hand-editing, a brain is built in the browser (persona + ≥1 MCP w/ credential
  requirement + ≥1 skill + a memory fact), Review validates clean (0 secrets, permission sheet +
  credential requirements shown), and Export produces a signed `.uniqent` that passes
  `core.validateBundle`.
- Server unit tests pass; `pnpm build`, `typecheck`, `lint`, `test` all pass.
- The live browser run is demonstrated with screenshots.
