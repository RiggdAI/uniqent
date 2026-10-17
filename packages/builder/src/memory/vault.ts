import type { MemoryKind } from '@uniqent/spec';
import { parseMemoryMarkdown, stripMemoryMarkup, type ImportedMemoryItem } from './parse.js';

/**
 * Import a "second-brain" Obsidian-style vault (a folder of markdown) into the parts of a Brain.
 * This is the framework-agnostic, PURE logic: it operates on already-read files (`{ path, content }`)
 * so it stays testable and free of any filesystem dependency — the I/O (walking the directory) lives
 * in the Studio server / CLI. The dominant pattern in the ecosystem (SOUL.md / USER.md / MEMORY.md +
 * `[[wikilinks]]` and `#tags`) maps cleanly onto our persona / profile / memory model.
 */
export interface VaultFile {
  /** Path relative to the vault root, POSIX separators (e.g. "notes/architecture.md"). */
  path: string;
  content: string;
}

export interface VaultMemoryItem extends ImportedMemoryItem {
  /** Provenance: the relative path of the note this came from. */
  source: string;
}

export interface VaultImport {
  /** From the vault root's SOUL.md (or PERSONA.md/AGENTS.md/CLAUDE.md). */
  persona?: string;
  /** From the vault root's USER.md, parsed into key/value (free prose lands under `notes`). */
  profile?: Record<string, string>;
  /** Memory items from MEMORY.md and every other note. */
  items: VaultMemoryItem[];
  stats: {
    files: number;
    personaFrom?: string;
    profileFrom?: string;
    memoryFiles: number;
    items: number;
    episodic: number;
  };
}

const base = (p: string): string => p.split('/').pop() ?? p;
const lc = (s: string): string => s.toLowerCase();

// Persona source files at the vault ROOT, in priority order (first match wins). The same names
// deeper in the tree (e.g. projects/x/CLAUDE.md, archive/USER.md) are ordinary notes.
const PERSONA_FILES = ['soul.md', 'persona.md', 'agents.md', 'claude.md'];
const PROFILE_FILE = 'user.md';

// A note is "episodic" (a journal/session log, scrubbed on export by default) when its path sits
// under a journal-like folder OR its filename starts with an ISO date.
const EPISODIC_DIR = /(^|\/)(daily|dailies|journal|journals|logs|periodic[ -]?notes?)(\/|$)/i;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
function isEpisodic(path: string): boolean {
  return EPISODIC_DIR.test(path) || DATE_PREFIX.test(base(path));
}

// USER.md profile lines, after bold/italic markers are stripped: "Name: Max", "Role: founder",
// "Location:: Berlin" (dataview inline field). Key is the lazy run before the first colon(s); a
// bare URL ("https://…") is not a key/value line.
const PROFILE_LINE = /^([A-Za-z][\w ./-]{0,40}?)\s*::?\s*(?!\/\/)(.+)$/;

/** Set `key`, joining with "; " onto an existing value so a repeated key never overwrites. */
function withValue(
  profile: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const prev = profile[key];
  return { ...profile, [key]: prev === undefined ? value : `${prev}; ${value}` };
}

/**
 * Parse USER.md into a flat profile record. Repeated keys are joined with "; "; prose with no
 * key/value pairs is joined into `notes` (appended to an explicit `notes:` value). Nothing is
 * truncated.
 */
export function parseProfile(md: string): Record<string, string> {
  let out: Record<string, string> = {};
  const leftover: string[] = [];
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line)) continue; // skip blanks + headings
    // Drop a leading bullet and bold/italic markers so "**Name:** Max" matches "Name: Max".
    const clean = line
      .replace(/^[-*+]\s+/, '')
      .replace(/\*\*|__/g, '')
      .trim();
    const m = clean.match(PROFILE_LINE);
    if (m && m[1] && m[2]) {
      const key = stripMemoryMarkup(m[1]).trim();
      const val = stripMemoryMarkup(m[2]).trim();
      if (key && val) {
        out = withValue(out, key, val);
        continue;
      }
    }
    leftover.push(stripMemoryMarkup(clean));
  }
  const notes = leftover.join(' ').trim();
  return notes ? withValue(out, 'notes', notes) : out;
}

export function importVault(files: VaultFile[]): VaultImport {
  const mdFiles = files.filter((f) => lc(f.path).endsWith('.md'));
  const rootFiles = mdFiles.filter((f) => !f.path.includes('/'));

  // Persona: first matching root file by priority.
  let persona: string | undefined;
  let personaFrom: string | undefined;
  for (const want of PERSONA_FILES) {
    const hit = rootFiles.find((f) => lc(f.path) === want);
    if (hit) {
      persona = hit.content.trim() || undefined;
      personaFrom = hit.path;
      break;
    }
  }

  // Profile: the root USER.md.
  let profile: Record<string, string> | undefined;
  let profileFrom: string | undefined;
  const userFile = rootFiles.find((f) => lc(f.path) === PROFILE_FILE);
  if (userFile) {
    const parsed = parseProfile(userFile.content);
    if (Object.keys(parsed).length > 0) {
      profile = parsed;
      profileFrom = userFile.path;
    }
  }

  // Memory: MEMORY.md + every note that isn't the persona/profile source.
  const consumed = new Set([personaFrom, profileFrom].filter(Boolean) as string[]);
  const items: VaultMemoryItem[] = [];
  let memoryFiles = 0;
  let episodic = 0;
  for (const f of mdFiles) {
    if (consumed.has(f.path)) continue;
    const parsed = parseMemoryMarkdown(f.content);
    if (parsed.length === 0) continue;
    memoryFiles++;
    const forceEpisodic = isEpisodic(f.path);
    for (const it of parsed) {
      const kind: MemoryKind = forceEpisodic ? 'episodic' : it.kind;
      if (kind === 'episodic') episodic++;
      items.push({ ...it, kind, source: f.path });
    }
  }

  return {
    persona,
    profile,
    items,
    stats: {
      files: mdFiles.length,
      ...(personaFrom ? { personaFrom } : {}),
      ...(profileFrom ? { profileFrom } : {}),
      memoryFiles,
      items: items.length,
      episodic,
    },
  };
}
