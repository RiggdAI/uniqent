import type { Bundle } from '@uniqent/core/pure';
import { Brain } from '@uniqent/builder/brain';
import {
  joinPath,
  readText,
  type InputRequest,
  type ReadFiles,
  type TargetContext,
} from '@uniqent/adapter-sdk/pure';
import type { CredentialRequirement, MemoryProfile } from '@uniqent/spec';
import { readMcpServers } from './config.js';
import { fromHermesMcp } from './mcp.js';
import { parseEntries } from './memory.js';
import { CONFIG_FILE, MEMORY_FILE, SKILLS_DIR, SOUL_FILE, USER_FILE } from './translate.js';

/** Directories Hermes never scans for skills (agent/skill_utils.py EXCLUDED_SKILL_DIRS). */
const EXCLUDED_DIRS = ['venv', 'node_modules', 'site-packages', '__pycache__'];
const SKILL_FILE = 'SKILL.md';
const CAPTURED_AT = '1970-01-01T00:00:00.000Z';

/** Two skill directories under skills/ share a name, which a bundle cannot hold. */
export class DuplicateSkillError extends Error {
  constructor(
    readonly skillName: string,
    readonly dirs: [string, string],
  ) {
    super(`two Hermes skills are both named "${skillName}": ${dirs[0]} and ${dirs[1]}`);
    this.name = 'DuplicateSkillError';
  }
}

/** Files a capture reads: the $HERMES_HOME files it maps, plus every SKILL.md under skills/. */
export function captureInputs(_read: ReadFiles, ctx: TargetContext): InputRequest {
  return {
    files: [SOUL_FILE, MEMORY_FILE, USER_FILE, CONFIG_FILE].map((path) => ({
      root: ctx.root,
      path,
    })),
    finds: [{ root: ctx.root, dir: SKILLS_DIR, fileName: SKILL_FILE, skipDirs: EXCLUDED_DIRS }],
  };
}

/**
 * Every skill directory (one holding SKILL.md) under skills/, at any depth, root-relative and
 * sorted. Like Hermes, a skill directory's subdirectories are not skills of their own.
 */
function skillDirs(read: ReadFiles, root: string): string[] {
  const skills = joinPath(root, SKILLS_DIR);
  const suffix = `/${SKILL_FILE}`;
  const dirs = [...read.keys()]
    .filter((k) => k.startsWith(`${skills}/`) && k.endsWith(suffix))
    .map((k) => k.slice(0, -suffix.length));
  return dirs
    .filter((d) => !dirs.some((other) => d.startsWith(`${other}/`)))
    .sort()
    .map((d) => `${SKILLS_DIR}${d.slice(skills.length)}`);
}

/** USER.md entries back into a profile: `key: value` entries keep their key. */
function profileFrom(entries: string[]): MemoryProfile {
  const profile: MemoryProfile = {};
  entries.forEach((entry, i) => {
    const m = /^([^:\n]+):\s(.*)$/s.exec(entry);
    const key = m?.[1]?.trim();
    if (m?.[2] !== undefined && key !== undefined && !(key in profile)) profile[key] = m[2];
    else profile[`entry${i + 1}`] = entry;
  });
  return profile;
}

/**
 * Capture a $HERMES_HOME back into a canonical bundle: SOUL.md → persona, memories/ → facts +
 * profile, skills/ (any depth) → skills, config.yaml mcp_servers → MCP servers whose credential
 * REQUIREMENTS are recovered from `${VAR}` refs — never their values.
 */
export function capture(read: ReadFiles, ctx: TargetContext): Bundle {
  const brain = Brain.create({
    name: 'captured-hermes-agent',
    displayName: 'Captured Hermes Agent',
    version: '0.1.0',
    description: 'Captured from a Hermes setup.',
    author: { name: 'unknown' },
    license: 'CC0-1.0',
    tags: [],
  });

  const soul = readText(read, ctx.root, SOUL_FILE);
  if (soul !== undefined) brain.setPersona(soul);

  const memory = readText(read, ctx.root, MEMORY_FILE);
  parseEntries(memory ?? '').forEach((text, i) =>
    brain.addMemory({ id: `m${i + 1}`, kind: 'fact', text, createdAt: CAPTURED_AT }),
  );
  const user = readText(read, ctx.root, USER_FILE);
  if (user !== undefined && parseEntries(user).length > 0)
    brain.setProfile(profileFrom(parseEntries(user)));

  const seen = new Map<string, string>();
  for (const dir of skillDirs(read, ctx.root)) {
    const name = dir.slice(dir.lastIndexOf('/') + 1);
    const other = seen.get(name);
    if (other !== undefined) throw new DuplicateSkillError(name, [other, dir]);
    seen.set(name, dir);
    // skillDirs() only lists directories whose SKILL.md was read.
    brain.addSkill(name, readText(read, ctx.root, `${dir}/${SKILL_FILE}`)!);
  }

  const credentials = new Map<string, CredentialRequirement>();
  for (const [id, raw] of Object.entries(readMcpServers(readText(read, ctx.root, CONFIG_FILE)))) {
    const captured = fromHermesMcp(id, raw);
    brain.addMcpServer(captured.server);
    for (const c of captured.credentials) {
      const prev = credentials.get(c.ref);
      credentials.set(
        c.ref,
        prev === undefined
          ? c
          : { ...prev, consumedBy: [...new Set([...prev.consumedBy, ...c.consumedBy])] },
      );
    }
  }
  for (const c of credentials.values()) brain.addCredential(c);

  return brain.toBundle();
}
