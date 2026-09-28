import { describe, it, expect } from 'vitest';
import { hasJsonContentType, isLocalApiRequest } from '../src/server/guard';

describe('isLocalApiRequest', () => {
  it('allows the exact Studio host with no Origin (same-origin GET)', () => {
    expect(isLocalApiRequest({ host: 'localhost:4173' }, 4173)).toBe(true);
    expect(isLocalApiRequest({ host: '127.0.0.1:4173' }, 4173)).toBe(true);
  });

  it("allows Studio's own Origin", () => {
    expect(
      isLocalApiRequest({ host: 'localhost:4173', origin: 'http://localhost:4173' }, 4173),
    ).toBe(true);
    expect(
      isLocalApiRequest({ host: '127.0.0.1:4173', origin: 'http://127.0.0.1:4173' }, 4173),
    ).toBe(true);
  });

  it('rejects a page served from another localhost port (CSRF)', () => {
    expect(
      isLocalApiRequest({ host: 'localhost:4173', origin: 'http://localhost:5173' }, 4173),
    ).toBe(false);
    expect(isLocalApiRequest({ host: '127.0.0.1:4173', origin: 'http://127.0.0.1' }, 4173)).toBe(
      false,
    );
    expect(isLocalApiRequest({ host: 'localhost:4173', origin: 'null' }, 4173)).toBe(false);
  });

  it('rejects a Host that is not this server (DNS-rebinding, wrong port, no port)', () => {
    expect(
      isLocalApiRequest(
        { host: 'studio.evil.example.com:4173', origin: 'http://localhost:4173' },
        4173,
      ),
    ).toBe(false);
    expect(isLocalApiRequest({ host: 'localhost:5173' }, 4173)).toBe(false);
    expect(isLocalApiRequest({ host: 'localhost' }, 4173)).toBe(false);
  });

  it('rejects a cross-origin request', () => {
    expect(
      isLocalApiRequest({ host: 'localhost:4173', origin: 'https://evil.example.com' }, 4173),
    ).toBe(false);
  });

  it('rejects a missing Host', () => {
    expect(isLocalApiRequest({}, 4173)).toBe(false);
  });
});

describe('hasJsonContentType', () => {
  it('accepts application/json with or without parameters', () => {
    expect(hasJsonContentType({ 'content-type': 'application/json' })).toBe(true);
    expect(hasJsonContentType({ 'content-type': 'Application/JSON; charset=utf-8' })).toBe(true);
  });

  it('rejects the "simple" types a cross-origin page can send without a preflight', () => {
    expect(hasJsonContentType({ 'content-type': 'text/plain' })).toBe(false);
    expect(hasJsonContentType({ 'content-type': 'application/x-www-form-urlencoded' })).toBe(false);
    expect(hasJsonContentType({ 'content-type': 'multipart/form-data; boundary=x' })).toBe(false);
    expect(hasJsonContentType({})).toBe(false);
  });
});
