import { describe, it, expect } from 'vitest';
import { Bundle } from '../src/bundle';
import { findCredentialRefs, resolvePlaceholders } from '../src/secret-refs';

describe('secret-refs', () => {
  it('finds credentialRef placeholders across files', () => {
    const b = Bundle.empty();
    b.set('mcp/servers.json', JSON.stringify({ env: { TOKEN: '${credentialRef:github_pat}' } }));
    b.set('a.md', 'uses ${credentialRef:other}');
    const refs = findCredentialRefs(b);
    expect(refs.map((r) => r.ref).sort()).toEqual(['github_pat', 'other']);
  });

  it('resolves placeholders from a map', () => {
    expect(resolvePlaceholders('Bearer ${credentialRef:tok}', { tok: 'XYZ' })).toBe('Bearer XYZ');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(resolvePlaceholders('${credentialRef:missing}', {})).toBe('${credentialRef:missing}');
  });
});
