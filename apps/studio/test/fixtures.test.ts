import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StudioSession } from '../src/server/session.js';
import { applyContentScript } from '../scripts/emit-fixtures.js';

const fx = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8')) as unknown;

describe('golden fixtures stay in sync with the TS session', () => {
  it('default state matches state-default.json', () => {
    expect(JSON.parse(JSON.stringify(new StudioSession().state()))).toEqual(
      fx('state-default.json'),
    );
  });
  it('catalog matches catalog.json', () => {
    expect(JSON.parse(JSON.stringify(new StudioSession().catalog()))).toEqual(fx('catalog.json'));
  });
  it('the canonical mutation script matches state-mutated.json', () => {
    const s = new StudioSession();
    s.setMeta({
      name: 'fixture-brain',
      description: 'A fixture brain for cross-impl tests',
      version: '1.2.3',
    });
    s.setTargets(['claude-code', 'hermes']);
    s.setPersona('# Persona\n\nYou are the fixture.');
    s.setReadme('# Readme\n\nFixture readme.');
    expect(JSON.parse(JSON.stringify(s.state()))).toEqual(fx('state-mutated.json'));
  });
  it('empty-string persona keeps key present (identity: true); whitespace readme drops key — matches state-cleared.json', () => {
    const s = new StudioSession();
    s.setMeta({
      name: 'fixture-brain',
      description: 'A fixture brain for cross-impl tests',
      version: '1.2.3',
    });
    s.setTargets(['claude-code', 'hermes']);
    s.setPersona('# Persona\n\nYou are the fixture.');
    s.setReadme('# Readme\n\nFixture readme.');
    s.setPersona('');
    s.setReadme('  ');
    expect(JSON.parse(JSON.stringify(s.state()))).toEqual(fx('state-cleared.json'));
  });
  it('content script (mcp/skill/channel/task/memory/profile) matches state-content.json', () => {
    const s = new StudioSession();
    s.setMeta({
      name: 'fixture-brain',
      description: 'A fixture brain for cross-impl tests',
      version: '1.2.3',
    });
    s.setTargets(['claude-code', 'hermes']);
    s.setPersona('# Persona\n\nYou are the fixture.');
    s.setReadme('# Readme\n\nFixture readme.');
    applyContentScript(s);
    expect(JSON.parse(JSON.stringify(s.state()))).toEqual(fx('state-content.json'));
  });
});
