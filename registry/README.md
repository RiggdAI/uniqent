# Uniqent registry

A registry is **just a JSON index file hosted at any URL** — there is no required service. The
registry is optional convenience; bundles always install from a raw file or URL without it.

## Format

[`index.json`](index.json) is `{ "bundles": RegistryEntry[] }`, where each entry is:

```ts
RegistryEntry = {
  name: string;          // slug, used for `install <name>`
  version?: string;      // semver; match a specific one with --version
  description?: string;
  url: string;           // where the packed .uniqent is hosted
  tags?: string[];
  author?: string;
}
```

## Use it

```bash
# Point at any hosted index (raw GitHub, S3, your own host)
export UNIQENT_REGISTRY=https://raw.githubusercontent.com/RiggdAI/uniqent/main/registry/index.json

uniqent search coding                       # filter by name/description/tags
uniqent install dev-powerpack --target hermes --root .   # resolve slug → url → install
# --registry <url> works in place of the env var; --version pins a release
```

## Publish

1. `uniqent pack examples/dev-powerpack -o dev-powerpack.uniqent` (optionally `uniqent sign`).
2. Host the `.uniqent` anywhere (a GitHub release asset, object storage, a static file server).
3. Add an entry to an `index.json` you host. That's it — no account, no server.
