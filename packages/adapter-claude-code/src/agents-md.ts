import type { Bundle } from '@uniqent/core';
import { stripMemoryMarkup } from '@uniqent/builder';

export const MANAGED_BEGIN = '<!-- uniqent:begin -->';
export const MANAGED_END = '<!-- uniqent:end -->';

/** A file's uniqent-managed markers are unbalanced, duplicated, or out of order. */
export class ManagedSectionError extends Error {
  constructor(
    readonly file: string,
    readonly reason: string,
  ) {
    super(
      `${file}: ${reason}. Expected exactly one "${MANAGED_BEGIN}" followed by one "${MANAGED_END}"; fix the markers, then re-run the install.`,
    );
    this.name = 'ManagedSectionError';
  }
}

interface ManagedBounds {
  start: number;
  end: number;
}

function findManagedBounds(file: string, text: string): ManagedBounds | undefined {
  const begins = text.split(MANAGED_BEGIN).length - 1;
  const ends = text.split(MANAGED_END).length - 1;
  if (begins === 0 && ends === 0) return undefined;
  if (begins !== 1 || ends !== 1)
    throw new ManagedSectionError(file, `found ${begins} begin and ${ends} end marker(s)`);
  const start = text.indexOf(MANAGED_BEGIN);
  const endMarker = text.indexOf(MANAGED_END);
  if (endMarker < start) throw new ManagedSectionError(file, 'end marker precedes begin marker');
  return { start, end: endMarker + MANAGED_END.length };
}

/**
 * Insert or replace the uniqent-managed section of `existing` with `body`, preserving every byte
 * outside the markers. A file without markers gets the section appended; `undefined` = new file.
 */
export function upsertManagedSection(
  file: string,
  existing: string | undefined,
  body: string,
): string {
  const section = `${MANAGED_BEGIN}\n${body.trim()}\n${MANAGED_END}`;
  if (existing === undefined || existing.trim() === '') return `${section}\n`;
  const bounds = findManagedBounds(file, existing);
  if (bounds) return existing.slice(0, bounds.start) + section + existing.slice(bounds.end);
  return `${existing.trimEnd()}\n\n${section}\n`;
}

/** The trimmed content of the uniqent-managed section, or undefined when the file has none. */
export function readManagedSection(file: string, text: string): string | undefined {
  const bounds = findManagedBounds(file, text);
  if (!bounds) return undefined;
  return text.slice(bounds.start + MANAGED_BEGIN.length, bounds.end - MANAGED_END.length).trim();
}

/** The file's own content with the uniqent-managed section removed. */
export function stripManagedSection(file: string, text: string): string {
  const bounds = findManagedBounds(file, text);
  if (!bounds) return text;
  return text.slice(0, bounds.start) + text.slice(bounds.end);
}

function renderProfileValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Render persona + policies + profile + memory facts as AGENTS.md markdown, or undefined when
 * the bundle has none of them. Each part is written whenever it exists — independent of the others.
 */
export function renderAgentsBody(bundle: Bundle): string | undefined {
  const parts: string[] = [];
  const persona = bundle.persona();
  if (persona) parts.push(persona.trim(), '');
  const policies = bundle.policies();
  if (policies) parts.push('## Policies', '', policies.trim(), '');
  const profile = bundle.memoryProfile();
  if (profile && Object.keys(profile).length > 0) {
    parts.push('## Profile', '');
    for (const [k, v] of Object.entries(profile)) parts.push(`- ${k}: ${renderProfileValue(v)}`);
    parts.push('');
  }
  const facts = bundle.memoryFacts();
  if (facts.length > 0) {
    parts.push('## Memory', '');
    for (const f of facts) parts.push(`- ${stripMemoryMarkup(f.text)}`);
    parts.push('');
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/** Human summary of what `renderAgentsBody` will include, for the install plan. */
export function describeAgentsBody(bundle: Bundle): string {
  const parts: string[] = [];
  if (bundle.persona()) parts.push('persona');
  if (bundle.policies()) parts.push('policies');
  const profile = bundle.memoryProfile();
  if (profile && Object.keys(profile).length > 0) parts.push('profile');
  const facts = bundle.memoryFacts().length;
  if (facts > 0) parts.push(`${facts} memory fact(s)`);
  return parts.join(' + ');
}
