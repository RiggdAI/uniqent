import type { MemoryItem, MemoryProfile } from '@uniqent/spec';
import { stripMemoryMarkup } from '@uniqent/builder/memory';

/** Hermes joins memory entries with this delimiter (hermes-agent tools/memory_tool.py ENTRY_DELIMITER). */
export const ENTRY_DELIMITER = '\n§\n';

/**
 * Hermes' default char budgets for memories/MEMORY.md and memories/USER.md, measured on the
 * §-joined file (tools/memory_tool.py MemoryStore). config.yaml `memory.*_char_limit` overrides them.
 */
export const MEMORY_MAX = 2200;
export const USER_MAX = 1375;

/** One entry the bundle wants in a Hermes memory file. `id` names it in lossiness reports. */
export interface MemoryCandidate {
  id: string;
  text: string;
}

export interface SkippedEntry {
  id: string;
  reason: string;
}

/** Result of merging bundle entries into an existing Hermes memory file. */
export interface MergedEntries {
  /** File content: entries joined by ENTRY_DELIMITER, exactly as Hermes writes it. */
  content: string;
  /** Number of entries already in the file; they are always kept. */
  existing: number;
  added: string[];
  alreadyPresent: string[];
  skipped: SkippedEntry[];
}

/** Split a Hermes memory file into stripped, non-empty entries (mirrors MemoryStore._parse_entries). */
export function parseEntries(raw: string): string[] {
  return raw
    .split(ENTRY_DELIMITER)
    .map((e) => e.trim())
    .filter((e) => e.length > 0);
}

/**
 * Merge `candidates` (in priority order) into the `existing` entries under a char `limit`.
 * Existing entries are never removed. A candidate already present is not duplicated; one that
 * would push the joined file over the limit is skipped and the next one is still tried.
 */
export function mergeEntries(
  existing: string[],
  candidates: MemoryCandidate[],
  limit: number,
): MergedEntries {
  const entries = [...existing];
  const added: string[] = [];
  const alreadyPresent: string[] = [];
  const skipped: SkippedEntry[] = [];
  for (const c of candidates) {
    if (c.text.length === 0) {
      skipped.push({ id: c.id, reason: 'empty after stripping memory markup' });
      continue;
    }
    if (c.text.includes(ENTRY_DELIMITER)) {
      skipped.push({ id: c.id, reason: 'contains the Hermes entry delimiter "\\n§\\n"' });
      continue;
    }
    if (entries.includes(c.text)) {
      alreadyPresent.push(c.id);
      continue;
    }
    const size = [...entries, c.text].join(ENTRY_DELIMITER).length;
    if (size > limit) {
      skipped.push({ id: c.id, reason: `${c.text.length} chars, file would be ${size}` });
      continue;
    }
    entries.push(c.text);
    added.push(c.id);
  }
  return {
    content: entries.join(ENTRY_DELIMITER),
    existing: existing.length,
    added,
    alreadyPresent,
    skipped,
  };
}

const importanceOf = (m: MemoryItem): number =>
  typeof m.importance === 'number' ? m.importance : 0.5;

/** MEMORY.md candidates: facts by importance (desc, stable), markup stripped. */
export function factCandidates(facts: MemoryItem[]): MemoryCandidate[] {
  return [...facts]
    .sort((a, b) => importanceOf(b) - importanceOf(a))
    .map((f) => ({ id: f.id, text: stripMemoryMarkup(f.text).trim() }));
}

/** USER.md candidates: one `key: value` entry per profile field, in declaration order. */
export function profileCandidates(profile: MemoryProfile): MemoryCandidate[] {
  return Object.entries(profile).map(([k, v]) => ({
    id: k,
    text: `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.trim(),
  }));
}
