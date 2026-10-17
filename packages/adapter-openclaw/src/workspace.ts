import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Bundle } from '@uniqent/core';
import { stripMemoryMarkup } from '@uniqent/builder';

/**
 * The OpenClaw agent workspace (docs.openclaw.ai/concepts/agent-workspace): SOUL.md, AGENTS.md,
 * USER.md, MEMORY.md and `skills/`. It is separate from the state dir; the default is
 * `<stateDir>/workspace`, overridden by `agents.defaults.workspace` (which supports `~`).
 *
 * Uniqent never clobbers user-authored workspace files: it owns only a delimited managed
 * section, replaced on re-install, and keeps everything outside it byte-for-byte.
 */

export const MANAGED_BEGIN = '<!-- uniqent:begin -->';
export const MANAGED_END = '<!-- uniqent:end -->';

/** OpenClaw's default `agents.defaults.bootstrapMaxChars` (src/config/schema.help.models.ts). */
export const DEFAULT_BOOTSTRAP_MAX_CHARS = 20000;

/** A workspace file has an unbalanced or duplicated Uniqent managed section. */
export class ManagedSectionError extends Error {
  constructor(readonly file: string) {
    super(
      `${file} has a malformed Uniqent managed section (expected exactly one "${MANAGED_BEGIN}" ` +
        `followed by one "${MANAGED_END}"); fix or remove the markers and re-run install`,
    );
    this.name = 'ManagedSectionError';
  }
}

/**
 * Resolve the workspace dir: `agents.defaults.workspace` (`~` expanded, a relative path resolved
 * against the cwd as OpenClaw's resolveUserPath does), else `<root>/workspace`.
 */
export function resolveWorkspace(root: string, configured: string | undefined): string {
  if (configured === undefined) return join(resolve(root), 'workspace');
  const trimmed = configured.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/**
 * Put `body` into the managed section of a workspace file's text: replace an existing section in
 * place, or append one after the user's content. Idempotent for the same `body`.
 */
export function withManagedSection(
  file: string,
  existing: string | undefined,
  body: string,
): string {
  const section = `${MANAGED_BEGIN}\n${body.trim()}\n${MANAGED_END}`;
  if (existing === undefined || existing.trim() === '') return `${section}\n`;
  const begins = count(existing, MANAGED_BEGIN);
  const ends = count(existing, MANAGED_END);
  if (begins === 0 && ends === 0) return `${existing.trimEnd()}\n\n${section}\n`;
  const start = existing.indexOf(MANAGED_BEGIN);
  const end = existing.indexOf(MANAGED_END);
  if (begins !== 1 || ends !== 1 || end < start) throw new ManagedSectionError(file);
  return existing.slice(0, start) + section + existing.slice(end + MANAGED_END.length);
}

/** Drop the managed-section marker lines, keeping all content (used on export). */
export function withoutMarkers(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim() !== MANAGED_BEGIN && line.trim() !== MANAGED_END)
    .join('\n')
    .trim();
}

/** SOUL.md body: the persona. */
export function soulBody(bundle: Bundle): string | undefined {
  return bundle.persona();
}

/** AGENTS.md body: the bundle's operating policies. */
export function agentsBody(bundle: Bundle): string | undefined {
  return bundle.policies();
}

/** USER.md body: the structured profile as `- key: value` lines. */
export function userBody(bundle: Bundle): string | undefined {
  const profile = bundle.memoryProfile();
  if (!profile || Object.keys(profile).length === 0) return undefined;
  return Object.entries(profile)
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
}

/** MEMORY.md body: curated semantic memory, one fact per bullet. */
export function memoryBody(bundle: Bundle): string | undefined {
  const facts = bundle.memoryFacts();
  if (facts.length === 0) return undefined;
  return facts.map((f) => `- ${stripMemoryMarkup(f.text)}`).join('\n');
}
