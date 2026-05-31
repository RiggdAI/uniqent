import { Bundle, PATHS } from './bundle.js';

const dec = new TextDecoder();
const REF_RE = /\$\{credentialRef:([^}]+)\}/g;

export interface CredentialRefUse {
  path: string;
  ref: string;
}

/** Locate every ${credentialRef:<ref>} placeholder across all files (except signature.json). */
export function findCredentialRefs(bundle: Bundle): CredentialRefUse[] {
  const uses: CredentialRefUse[] = [];
  for (const [path, bytes] of bundle.entries()) {
    if (path === PATHS.signature) continue;
    const text = dec.decode(bytes);
    for (const m of text.matchAll(REF_RE)) {
      if (m[1]) uses.push({ path, ref: m[1] });
    }
  }
  return uses;
}

/** Replace ${credentialRef:<ref>} with resolved values; unknown refs are left untouched. */
export function resolvePlaceholders(value: string, resolved: Record<string, string>): string {
  return value.replace(REF_RE, (whole, ref: string) => {
    const resolvedValue = resolved[ref];
    return resolvedValue === undefined ? whole : resolvedValue;
  });
}
