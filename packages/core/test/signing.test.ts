import { describe, it, expect } from 'vitest';
import { generateKeypair, sign, verify } from '../src/signing';
import { SecretScanError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('signing', () => {
  it('signs and verifies a clean bundle', async () => {
    const { privateKey } = await generateKeypair();
    const signed = await sign(makeValidBundle(), privateKey);
    expect(signed.signature()).toBeDefined();
    const v = await verify(signed);
    expect(v).toMatchObject({ signed: true, valid: true });
  });

  it('reports unsigned bundles', async () => {
    const v = await verify(makeValidBundle());
    expect(v.signed).toBe(false);
    expect(v.valid).toBe(false);
  });

  it('fails verification when a file is tampered after signing', async () => {
    const { privateKey } = await generateKeypair();
    const signed = await sign(makeValidBundle(), privateKey);
    signed.set('identity/persona.md', '# Persona\nTAMPERED.\n');
    const v = await verify(signed);
    expect(v.valid).toBe(false);
  });

  it('throws SecretScanError when signing a bundle with a secret', async () => {
    const { privateKey } = await generateKeypair();
    const b = makeValidBundle();
    b.set('notes.md', 'sk-abcdefghijklmnopqrstuvwxyz0123456789');
    await expect(sign(b, privateKey)).rejects.toBeInstanceOf(SecretScanError);
  });
});
