import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalDigest, pack, sign, unpack, verify } from '@uniqent/core';
import { buildFixtureBundle } from '../scripts/emit-core-fixtures.ts';

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

describe('TS-drift guard: re-derives fixtures from live TS core', () => {
  it('canonicalDigest of buildFixtureBundle() matches committed expected-digest.txt (digest-semantics drift)', async () => {
    const bundle = buildFixtureBundle();
    expect(canonicalDigest(bundle) + '\n').toBe(
      readFileSync(join(dir, 'expected-digest.txt'), 'utf8'),
    );
  });

  it('pack → unpack → canonicalDigest is stable (pack/unpack drift)', async () => {
    const bundle = buildFixtureBundle();
    const packed = await pack(bundle, { skipValidation: true });
    const unpacked = await unpack(packed);
    expect(canonicalDigest(unpacked) + '\n').toBe(
      readFileSync(join(dir, 'expected-digest.txt'), 'utf8'),
    );
  });

  it('sign with committed private key then verify → {signed:true, valid:true} (sign-semantics drift)', async () => {
    const bundle = buildFixtureBundle();
    const kp = JSON.parse(readFileSync(join(dir, 'keypair.json'), 'utf8')) as {
      privateKey: string;
      publicKey: string;
    };
    const signed = await sign(bundle, kp.privateKey);
    const result = await verify(signed);
    expect(result).toMatchObject({ signed: true, valid: true });
  });
});
