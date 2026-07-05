import { readFileSync } from 'node:fs';
import { unpack, verify, canonicalDigest } from '@uniqent/core';

const file = process.argv[2];
if (!file) throw new Error('usage: tsx scripts/verify-file.ts <bundle.uniqent>');
const b = await unpack(new Uint8Array(readFileSync(file)));
const v = await verify(b);
console.log(JSON.stringify({ digest: canonicalDigest(b), ...v }, null, 2));
if (!v.signed || !v.valid) process.exit(1);
console.log('OK: TS core verifies this bundle');
