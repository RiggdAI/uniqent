import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bundle, canonicalDigest, pack, sign, generateKeypair, writeDir } from '@uniqent/core';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'core');
await mkdir(out, { recursive: true });

// A small, deterministic bundle exercising nested paths + jsonl + manifest.
const files = new Map<string, Uint8Array>();
const put = (p: string, s: string) => files.set(p, new TextEncoder().encode(s));
put(
  'uniqent.json',
  JSON.stringify(
    {
      spec: '0.1',
      name: 'core-fixture',
      displayName: 'Core Fixture',
      version: '1.0.0',
      description: 'Cross-impl core fixture brain',
      components: {
        identity: true,
        skills: [],
        mcp: [],
        memory: { facts: 1, episodic: 0, hasProfile: false },
        tasks: [],
        channels: [],
      },
    },
    null,
    2,
  ),
);
put('README.md', '# Core fixture\n');
put('identity/persona.md', '# Persona\n\nFixture persona.\n');
put('memory/facts.jsonl', JSON.stringify({ kind: 'fact', text: 'fixture fact' }) + '\n');

const bundle = Bundle.fromFiles(files);
await writeDir(bundle, join(out, 'files'));
await writeFile(join(out, 'expected-digest.txt'), canonicalDigest(bundle) + '\n');
await writeFile(join(out, 'fixture.uniqent'), await pack(bundle, { skipValidation: true }));

// Fixed throwaway keypair, committed so both impls can use it in tests.
const kp = await generateKeypair();
await writeFile(join(out, 'keypair.json'), JSON.stringify(kp, null, 2) + '\n');
const signed = await sign(bundle, kp.privateKey);
await writeFile(join(out, 'fixture-signed.uniqent'), await pack(signed, { skipValidation: true }));

console.log('core fixtures written to', out);
