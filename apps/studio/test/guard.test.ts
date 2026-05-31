import { describe, it, expect } from 'vitest';
import { isLocalApiRequest } from '../src/server/guard';

describe('isLocalApiRequest', () => {
  it('allows a local host with no Origin (same-origin GET)', () => {
    expect(isLocalApiRequest({ host: 'localhost:4173' })).toBe(true);
    expect(isLocalApiRequest({ host: '127.0.0.1:4173' })).toBe(true);
  });

  it('allows a localhost Origin', () => {
    expect(isLocalApiRequest({ host: 'localhost:4173', origin: 'http://localhost:4173' })).toBe(
      true,
    );
  });

  it('rejects a non-local Host (DNS-rebinding)', () => {
    expect(isLocalApiRequest({ host: 'studio.evil.example.com', origin: 'http://localhost' })).toBe(
      false,
    );
  });

  it('rejects a cross-origin request (CSRF)', () => {
    expect(isLocalApiRequest({ host: 'localhost:4173', origin: 'https://evil.example.com' })).toBe(
      false,
    );
  });

  it('rejects a missing or malformed Host', () => {
    expect(isLocalApiRequest({})).toBe(false);
    expect(isLocalApiRequest({ host: 'localhost', origin: 'not a url' })).toBe(false);
  });
});
