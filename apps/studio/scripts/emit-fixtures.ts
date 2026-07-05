import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioSession } from '../src/server/session.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
await mkdir(out, { recursive: true });

const write = (name: string, data: unknown) =>
  writeFile(join(out, name), JSON.stringify(data, null, 2) + '\n');

const s = new StudioSession();
await write('state-default.json', s.state());
await write('catalog.json', s.catalog());

// ── Canonical meta script (Phase 1) ─────────────────────────────────────────
// Keep in lockstep with src-tauri/tests/fixtures_test.rs.
s.setMeta({
  name: 'fixture-brain',
  description: 'A fixture brain for cross-impl tests',
  version: '1.2.3',
});
s.setTargets(['claude-code', 'hermes']);
s.setPersona('# Persona\n\nYou are the fixture.');
s.setReadme('# Readme\n\nFixture readme.');
await write('state-mutated.json', s.state());

// Cleared fixture: apply canonical mutations then clear persona (to '') and readme (whitespace-only).
// persona '' stays present with identity: true; readme whitespace-only drops the key.
s.setPersona('');
s.setReadme('  ');
await write('state-cleared.json', s.state());

// ── Canonical content script (Phase 3a) ──────────────────────────────────────
// Applied AFTER the canonical meta mutations on a fresh session.
// Exported as applyContentScript so the drift test re-derives independently.
// Keep in lockstep with src-tauri/tests/fixtures_test.rs (Task 2).

/**
 * Apply the canonical content-state script to a session that has already had
 * the canonical meta mutations applied (setMeta / setTargets / setPersona / setReadme).
 * The session's factCounter and taskCounter must be at 0 (fresh or reset).
 *
 * Canonical literals — DO NOT change without updating Task 2 (Rust port):
 *
 *   Step 1 – addMcpFromCatalog('github')
 *   Step 2 – addCustomMcp({ id: 'custom-api', name: 'Custom API', transport: 'streamable-http',
 *               url: 'https://api.example.com/mcp', auth: { type: 'none' } })
 *   Step 3 – addCustomSkill('fixture-skill', '# fixture-skill\n\nDoes fixture things.\n')
 *   Step 4 – addChannelFromCatalog('telegram')
 *   Step 5 – addTask({ name: 'Nightly digest', cron: '0 9 * * *', prompt: 'Summarize.' })
 *   Step 6a – addFact({ text: 'Fixture prefers [[Rust]] #perf', importance: 0.8 })
 *   Step 6b – addFact({ text: 'plain fact' })
 *   Step 7 – setProfile({ name: 'Fixture User', role: 'Tester' })
 *   Step 8 – removeMcp('custom-api'), then addCustomMcp(same literal as Step 2)
 */
export function applyContentScript(session: StudioSession): void {
  // Step 1: catalog MCP (first id: 'github')
  session.addMcpFromCatalog('github');

  // Step 2: custom MCP
  session.addCustomMcp({
    id: 'custom-api',
    name: 'Custom API',
    transport: 'streamable-http',
    url: 'https://api.example.com/mcp',
    auth: { type: 'none' },
  });

  // Step 3: custom skill
  session.addCustomSkill('fixture-skill', '# fixture-skill\n\nDoes fixture things.\n');

  // Step 4: catalog channel (first id: 'telegram')
  session.addChannelFromCatalog('telegram');

  // Step 5: task (triggerType defaults to 'schedule'; id generated as task-1 deterministically)
  session.addTask({ name: 'Nightly digest', cron: '0 9 * * *', prompt: 'Summarize.' });

  // Step 6: two facts (ids: fact-1, fact-2 — deterministic counter; createdAt not in state())
  session.addFact({ text: 'Fixture prefers [[Rust]] #perf', importance: 0.8 });
  session.addFact({ text: 'plain fact' });

  // Step 7: profile
  session.setProfile({ name: 'Fixture User', role: 'Tester' });

  // Step 8: remove then re-add custom-api to pin remove-semantics
  session.removeMcp('custom-api');
  session.addCustomMcp({
    id: 'custom-api',
    name: 'Custom API',
    transport: 'streamable-http',
    url: 'https://api.example.com/mcp',
    auth: { type: 'none' },
  });
}

// Emit state-content.json: fresh session → canonical meta → canonical content
export async function buildFixtureBundle(): Promise<void> {
  const sc = new StudioSession();
  sc.setMeta({
    name: 'fixture-brain',
    description: 'A fixture brain for cross-impl tests',
    version: '1.2.3',
  });
  sc.setTargets(['claude-code', 'hermes']);
  sc.setPersona('# Persona\n\nYou are the fixture.');
  sc.setReadme('# Readme\n\nFixture readme.');
  applyContentScript(sc);
  await write('state-content.json', sc.state());
}

await buildFixtureBundle();

console.log('fixtures written to', out);
