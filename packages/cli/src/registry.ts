import { readFile } from 'node:fs/promises';
import { download } from './download.js';

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

/** Registry URL or local index path from a flag, else the UNIQENT_REGISTRY env var. */
export function registryUrl(flag: string | true | undefined): string | undefined {
  if (typeof flag === 'string' && flag) return flag;
  const env = process.env.UNIQENT_REGISTRY;
  return env && env.length > 0 ? env : undefined;
}

function isEntry(v: unknown): v is RegistryEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  const optString = (x: unknown): boolean => x === undefined || typeof x === 'string';
  return (
    typeof e.name === 'string' &&
    typeof e.url === 'string' &&
    optString(e.version) &&
    optString(e.description) &&
    optString(e.author) &&
    (e.tags === undefined || (Array.isArray(e.tags) && e.tags.every((t) => typeof t === 'string')))
  );
}

/** Load a registry index from an https URL (http only on loopback) or a local file path. */
export async function fetchIndex(
  location: string,
  warn: (msg: string) => void,
): Promise<RegistryIndex> {
  const bytes = isUrl(location)
    ? await download(location, warn)
    : new Uint8Array(await readFile(location));
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new Error(`registry at ${location} is not valid JSON: ${(e as Error).message}`, {
      cause: e,
    });
  }
  const bundles = (json as { bundles?: unknown }).bundles;
  if (!Array.isArray(bundles)) throw new Error(`registry at ${location} has no "bundles" array`);
  const bad = bundles.findIndex((e) => !isEntry(e));
  if (bad !== -1)
    throw new Error(
      `registry at ${location}: bundles[${bad}] is malformed (needs string "name" and "url"; optional string version/description/author and string[] tags)`,
    );
  return { bundles: bundles as RegistryEntry[] };
}

/** An http(s) URL (as opposed to a local path). */
export function isUrl(target: string): boolean {
  return /^https?:\/\//i.test(target);
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
