# Governance

Uniqent is an open standard and an open-source toolchain. This document describes how decisions
are made while the project is young; it will formalize as the community grows.

## Scope of the standard

The canonical artifact is the `.uniqent` bundle format, defined by the zod schema in
`packages/spec` and published as `docs/SPEC.md` + a generated JSON Schema. The spec is dedicated
to the public domain (CC0) so that any framework can implement an adapter without permission.

## Spec versioning

- The bundle format carries an explicit `specVersion` (currently `0.1`).
- Backwards-incompatible changes bump the major part of the spec version and must document a
  migration path. Additive, optional fields may land within a version.
- A bundle declares the `specVersion` it was authored against; tools must refuse versions they do
  not understand rather than silently mis-parsing.

## Decision making

While pre-1.0, maintainers steward the spec and merge changes that uphold the non-negotiable
principles (see `BUILD_PLAN.md` §0). Substantial format changes should be proposed as an issue
with rationale and at least one reference implementation in an adapter before merging.

## Adapters

Adapters live in this repo for the v1 targets (OpenClaw, Hermes, Claude Code). Third-party
adapters are encouraged and may live in their own repos; the only requirement to claim
compatibility is passing the conformance harness in `packages/adapter-sdk`.
