import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bundle, canonicalDigest, unpack, verify } from '@uniqent/core';

const dir = fileURLToPath(new URL('../fixtures/core', import.meta.url));

describe('core fixtures stay in sync with @uniqent/core', () => {
  it('the packed fixture unpacks to the committed digest', async () => {
    const b = await unpack(new Uint8Array(readFileSync(join(dir, 'fixture.uniqent'))));
    expect(canonicalDigest(b) + '\n').toBe(readFileSync(join(dir, 'expected-digest.txt'), 'utf8'));
  });
  it('the signed fixture verifies with the committed key', async () => {
    const b = await unpack(new Uint8Array(readFileSync(join(dir, 'fixture-signed.uniqent'))));
    const kp = JSON.parse(readFileSync(join(dir, 'keypair.json'), 'utf8')) as { publicKey: string };
    const v = await verify(b);
    expect(v).toMatchObject({ signed: true, valid: true, publicKey: kp.publicKey });
  });
  it('signature.json does not change the digest', async () => {
    const b = await unpack(new Uint8Array(readFileSync(join(dir, 'fixture-signed.uniqent'))));
    expect(canonicalDigest(b) + '\n').toBe(readFileSync(join(dir, 'expected-digest.txt'), 'utf8'));
  });
});
