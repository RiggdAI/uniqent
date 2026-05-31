# Contributing to Uniqent

Thanks for helping build an open standard for portable AI agents.

## Ground rules

- **Read [`BUILD_PLAN.md`](BUILD_PLAN.md) first.** Work milestone by milestone; each milestone is
  "done" only when its acceptance criteria pass. Open one PR per milestone where practical.
- **The schema is the source of truth.** Change the bundle format in `packages/spec` (the zod
  schema), then regenerate the JSON Schema and `SPEC.md` (`pnpm --filter @uniqent/spec gen`).
  Never hand-edit generated artifacts.
- **Never put a secret value in a bundle or a test fixture.** The secret-scan gate will fail the
  build, and that's intended. Use credential _references_ and the install-time resolver.

## Dev workflow

```bash
pnpm install
pnpm build         # tsc build all packages
pnpm test          # vitest
pnpm typecheck
pnpm lint
pnpm format
```

- TypeScript, Node 22.13+ (the pinned pnpm requires it), ESM only.
- Tests with vitest; every package ships unit tests. Adapters ship round-trip conformance tests
  via the harness in `packages/adapter-sdk`.
- Conventional commits (e.g. `feat(spec): add channel schema`). Keep PRs small and focused.

## Adding an adapter

Implement the `Adapter` interface from `packages/adapter-sdk` (`detect/plan/apply/export`) and make
the conformance harness pass: no secrets written, lossiness fully reported, `apply()` idempotent on
a second run. Document the canonical→native mapping in the adapter's README.

## Licensing of contributions

By contributing you agree that code is licensed Apache-2.0 and spec text/schema is dedicated to the
public domain under CC0.
