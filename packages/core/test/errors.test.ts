import { describe, it, expect } from 'vitest';
import { SecretScanError, BundleValidationError, BundleFormatError } from '../src/errors';

describe('error classes', () => {
  it('SecretScanError carries findings and a name', () => {
    const e = new SecretScanError([{ path: 'uniqent.json', kind: 'openai', snippet: 'sk-…' }]);
    expect(e.name).toBe('SecretScanError');
    expect(e.findings).toHaveLength(1);
    expect(e instanceof Error).toBe(true);
  });

  it('BundleValidationError carries issues', () => {
    const e = new BundleValidationError([{ code: 'manifest', message: 'bad' }]);
    expect(e.name).toBe('BundleValidationError');
    expect(e.issues[0].code).toBe('manifest');
  });

  it('BundleFormatError is an Error', () => {
    expect(new BundleFormatError('x') instanceof Error).toBe(true);
  });
});
