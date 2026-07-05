import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bundle, canonicalDigest, pack, sign, generateKeypair, writeDir } from '@uniqent/core';

/**
 * Build the canonical in-memory fixture bundle.
 * Extracted so tests can re-derive it from the live TS core (drift guard).
 */
export function buildFixtureBundle(): Bundle {
  // A small, deterministic bundle exercising nested paths + jsonl + manifest.
  const files = new Map<string, Uint8Array>();
  const put = (p: string, s: string) => files.set(p, new TextEncoder().encode(s));
  put(
    'uniqent.json',
    // Trailing newline matches Prettier's enforced style so the on-disk file
    // and the in-memory bundle agree on byte-for-byte content.
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
    ) + '\n',
  );
  put('README.md', '# Core fixture\n');
  put('identity/persona.md', '# Persona\n\nFixture persona.\n');
  put('memory/facts.jsonl', JSON.stringify({ kind: 'fact', text: 'fixture fact' }) + '\n');

  return Bundle.fromFiles(files);
}

// Only run when executed directly (not when imported by tests).
const selfPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] != null && resolve(process.argv[1]) === resolve(selfPath);

if (isMain) {
  const out = join(dirname(selfPath), '..', 'fixtures', 'core');
  await mkdir(out, { recursive: true });

  const bundle = buildFixtureBundle();
  await writeDir(bundle, join(out, 'files'));
  await writeFile(join(out, 'expected-digest.txt'), canonicalDigest(bundle) + '\n');
  await writeFile(join(out, 'fixture.uniqent'), await pack(bundle, { skipValidation: true }));

  // Fixed throwaway keypair, committed so both impls can use it in tests.
  // Reuse committed keypair when available so re-runs are deterministic.
  let kp: { privateKey: string; publicKey: string };
  try {
    kp = JSON.parse(await readFile(join(out, 'keypair.json'), 'utf8'));
    console.log('reusing committed keypair');
  } catch {
    kp = await generateKeypair();
    await writeFile(join(out, 'keypair.json'), JSON.stringify(kp, null, 2) + '\n');
    console.log('generated new keypair');
  }
  const signed = await sign(bundle, kp.privateKey);
  // Note: signedAt inside fixture-signed.uniqent will still vary on each run.
  await writeFile(
    join(out, 'fixture-signed.uniqent'),
    await pack(signed, { skipValidation: true }),
  );

  console.log('core fixtures written to', out);
}
