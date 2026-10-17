import { describe, it, expect } from 'vitest';
import { defaultRoot, nextStep } from '../src/targets';

describe('target roots and next steps', () => {
  it('defaults each target to its native root, honouring the env overrides', () => {
    expect(defaultRoot('claude-code', {}, '/home/u', '/proj')).toBe('/proj');
    expect(defaultRoot('hermes', {}, '/home/u', '/proj')).toBe('/home/u/.hermes');
    expect(defaultRoot('hermes', { HERMES_HOME: '/h' }, '/home/u', '/proj')).toBe('/h');
    expect(defaultRoot('openclaw', {}, '/home/u', '/proj')).toBe('/home/u/.openclaw');
    expect(defaultRoot('openclaw', { OPENCLAW_STATE_DIR: '/o' }, '/home/u', '/proj')).toBe('/o');
    expect(() => defaultRoot('nope', {}, '/home/u', '/proj')).toThrow('unknown target "nope"');
  });

  it('gives a target-specific next step', () => {
    expect(nextStep('claude-code', '/proj')).toContain('Claude Code');
    expect(nextStep('hermes', '/h')).toContain('hermes cron create');
    expect(nextStep('openclaw', '/o')).toContain('Restart the OpenClaw gateway');
  });
});
