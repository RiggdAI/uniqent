import { describe, it, expect } from 'vitest';
import * as core from '../src/index';

describe('public API', () => {
  it('re-exports the engine surface', () => {
    for (const name of [
      'Bundle',
      'PATHS',
      'canonicalDigest',
      'scanForSecrets',
      'validateBundle',
      'assertValid',
      'generateKeypair',
      'sign',
      'verify',
      'pack',
      'unpack',
      'readDir',
      'writeDir',
      'findCredentialRefs',
      'resolvePlaceholders',
      'SecretScanError',
      'BundleValidationError',
      'BundleFormatError',
    ]) {
      expect(core).toHaveProperty(name);
    }
  });
});
