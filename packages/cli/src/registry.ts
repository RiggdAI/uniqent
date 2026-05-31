/**
 * Minimal registry: a registry is just a JSON index hosted at any URL — no service required.
 * `search` and install-by-slug resolve against it; publishing = host a .uniqent and add an entry.
 */
export interface RegistryEntry {
  name: string;
  version?: string;
  description?: string;
  url: string;
  tags?: string[];
  author?: string;
}

export interface RegistryIndex {
  bundles: RegistryEntry[];
}

/** Registry URL from a flag, else the UNIQENT_REGISTRY env var. */
export function registryUrl(flag: string | true | undefined): string | undefined {
  if (typeof flag === 'string' && flag) return flag;
  const env = process.env.UNIQENT_REGISTRY;
  return env && env.length > 0 ? env : undefined;
}

export async function fetchIndex(url: string): Promise<RegistryIndex> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`registry fetch failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as Partial<RegistryIndex>;
  if (!Array.isArray(json.bundles)) throw new Error(`registry at ${url} has no "bundles" array`);
  return { bundles: json.bundles };
}

export function findEntry(
  index: RegistryIndex,
  name: string,
  version?: string,
): RegistryEntry | undefined {
  return index.bundles.find((e) => e.name === name && (!version || e.version === version));
}

/** A bare slug (not a path or URL): lowercase letters/digits/hyphens, no slash or dot. */
export function looksLikeSlug(target: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(target);
}
