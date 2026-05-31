import { describe, it, expect } from 'vitest';
import { Bundle } from '../src/bundle';
import { canonicalDigest } from '../src/digest';

describe('canonicalDigest', () => {
  it('is identical for identical content regardless of insertion order', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    a.set('b.txt', '2');
    const b = Bundle.empty();
    b.set('b.txt', '2');
    b.set('a.txt', '1');
    expect(canonicalDigest(a)).toBe(canonicalDigest(b));
  });

  it('changes when any byte changes', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    const b = Bundle.empty();
    b.set('a.txt', '2');
    expect(canonicalDigest(a)).not.toBe(canonicalDigest(b));
  });

  it('excludes signature.json from the digest', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    const b = Bundle.empty();
    b.set('a.txt', '1');
    b.set('signature.json', '{"anything":true}');
    expect(canonicalDigest(a)).toBe(canonicalDigest(b));
  });

  it('returns a 64-char hex sha256 string', () => {
    const a = Bundle.empty();
    a.set('a.txt', '1');
    expect(canonicalDigest(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
