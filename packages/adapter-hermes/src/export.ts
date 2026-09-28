import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import type { Bundle } from '@uniqent/core';
import { Brain } from '@uniqent/builder';
import type { CredentialRequirement, MemoryProfile } from '@uniqent/spec';
import { readMcpServers } from './config.js';
import { readOptional } from './fs.js';
import { fromHermesMcp } from './mcp.js';
import { parseEntries } from './memory.js';
import { CONFIG_FILE, MEMORY_FILE, SOUL_FILE, USER_FILE } from './translate.js';

/** Directories Hermes never scans for skills (agent/skill_utils.py EXCLUDED_SKILL_DIRS). */
const EXCLUDED_DIRS = new Set(['venv', 'node_modules', 'site-packages', '__pycache__']);
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

/** Every skill directory (one holding SKILL.md) under `dir`, at any depth, sorted. */
async function findSkillDirs(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return [];
    throw err;
  }
  if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) return [dir];
  const nested = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !EXCLUDED_DIRS.has(e.name))
      .map((e) => findSkillDirs(join(dir, e.name))),
  );
  return nested.flat().sort();
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
export async function exportHermes(root: string): Promise<Bundle> {
  const brain = Brain.create({
    name: 'captured-hermes-agent',
    displayName: 'Captured Hermes Agent',
    version: '0.1.0',
    description: 'Captured from a Hermes setup.',
    author: { name: 'unknown' },
    license: 'CC0-1.0',
    tags: [],
  });

  const soul = await readOptional(join(root, SOUL_FILE));
  if (soul !== undefined) brain.setPersona(soul);

  const memory = await readOptional(join(root, MEMORY_FILE));
  parseEntries(memory ?? '').forEach((text, i) =>
    brain.addMemory({ id: `m${i + 1}`, kind: 'fact', text, createdAt: CAPTURED_AT }),
  );
  const user = await readOptional(join(root, USER_FILE));
  if (user !== undefined && parseEntries(user).length > 0)
    brain.setProfile(profileFrom(parseEntries(user)));

  const skillsRoot = join(root, 'skills');
  const seen = new Map<string, string>();
  for (const dir of await findSkillDirs(skillsRoot)) {
    const name = basename(dir);
    const rel = relative(root, dir);
    const other = seen.get(name);
    if (other !== undefined) throw new DuplicateSkillError(name, [other, rel]);
    seen.set(name, rel);
    brain.addSkill(name, await readFile(join(dir, 'SKILL.md'), 'utf8'));
  }

  const credentials = new Map<string, CredentialRequirement>();
  for (const [id, raw] of Object.entries(
    readMcpServers(await readOptional(join(root, CONFIG_FILE))),
  )) {
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
