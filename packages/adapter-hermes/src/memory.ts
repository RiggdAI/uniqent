import type { MemoryItem, MemoryProfile } from '@uniqent/spec';
import { stripMemoryMarkup } from '@uniqent/builder';

/** Hermes memory bounds (chars). */
export const MEMORY_MAX = 2200;
export const USER_MAX = 1375;

const importanceOf = (m: MemoryItem): number =>
  typeof m.importance === 'number' ? m.importance : 0.5;

/**
 * Build a bounded MEMORY.md: facts sorted by importance (desc), included until the char
 * budget is hit. Returns how many were dropped so the caller can report the loss.
 */
export function buildMemoryMd(
  facts: MemoryItem[],
  max: number = MEMORY_MAX,
): { content: string; included: number; dropped: number } {
  const sorted = [...facts].sort((a, b) => importanceOf(b) - importanceOf(a));
  const header = '# Memory\n\n';
  let body = '';
  let included = 0;
  for (const f of sorted) {
    const line = `- ${stripMemoryMarkup(f.text)}\n`;
    if (header.length + body.length + line.length > max) break;
    body += line;
    included++;
  }
  return { content: header + body, included, dropped: facts.length - included };
}

/** Build a bounded USER.md from the structured profile. */
export function buildUserMd(
  profile: MemoryProfile,
  max: number = USER_MAX,
): { content: string; truncated: boolean } {
  const header = '# User\n\n';
  let body = '';
  let truncated = false;
  for (const [k, v] of Object.entries(profile)) {
    const line = `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}\n`;
    if (header.length + body.length + line.length > max) {
      truncated = true;
      break;
    }
    body += line;
  }
  return { content: header + body, truncated };
}

/** Env var name for a credential ref, e.g. github_pat → GITHUB_PAT. */
export function envName(ref: string): string {
  return ref.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}
