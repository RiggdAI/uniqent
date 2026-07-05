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

// Canonical mutation script — keep in lockstep with src-tauri/tests/fixtures_test.rs.
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

console.log('fixtures written to', out);
