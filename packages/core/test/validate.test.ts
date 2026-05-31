import { describe, it, expect } from 'vitest';
import { validateBundle, assertValid } from '../src/validate';
import { BundleValidationError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('validateBundle', () => {
  it('accepts a valid bundle', () => {
    const r = validateBundle(makeValidBundle());
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('errors when identity is declared but persona.md is missing', () => {
    const b = makeValidBundle();
    b.delete('identity/persona.md');
    const r = validateBundle(b);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'layout')).toBe(true);
  });

  it('errors on a dangling credentialRef', () => {
    const b = makeValidBundle();
    b.set(
      'mcp/servers.json',
      JSON.stringify({
        servers: [
          {
            id: 'github',
            transport: 'streamable-http',
            url: 'https://example.com/mcp',
            auth: { type: 'bearer', credentialRef: 'does_not_exist' },
            tools: { include: 'all' },
          },
        ],
      }),
    );
    const r = validateBundle(b);
    expect(r.errors.some((e) => e.code === 'credential-ref')).toBe(true);
  });

  it('errors when a planted secret is present', () => {
    const b = makeValidBundle();
    b.set('identity/persona.md', 'my key is sk-abcdefghijklmnopqrstuvwxyz0123456789');
    const r = validateBundle(b);
    expect(r.errors.some((e) => e.code === 'secret')).toBe(true);
  });

  it('errors when a declared skill is missing SKILL.md', () => {
    const b = makeValidBundle();
    b.delete('skills/code-review/SKILL.md');
    const r = validateBundle(b);
    expect(r.errors.some((e) => e.code === 'layout')).toBe(true);
  });

  it('assertValid throws BundleValidationError on an invalid bundle', () => {
    const b = makeValidBundle();
    b.delete('uniqent.json');
    expect(() => assertValid(b)).toThrow(BundleValidationError);
  });
});
