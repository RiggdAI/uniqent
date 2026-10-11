import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain } from '@uniqent/builder';
import { generateKeypair, sign, pack, Bundle, PATHS } from '@uniqent/core';
import { run, type CliIo } from '../src/run';
import { loadToken, saveToken } from '../src/credentials';

function capture(): { io: CliIo; logs: string[]; errs: string[] } {
  const logs: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m) => logs.push(m), error: (m) => errs.push(m) }, logs, errs };
}

const tmp = (): string => mkdtempSync(join(tmpdir(), 'uniqent-hard-'));

function brain(): Bundle {
  const b = Brain.create({
    name: 'dev',
    displayName: 'Dev',
    version: '0.1.0',
    description: 'demo brain',
    author: { name: 'me' },
    license: 'CC0-1.0',
    tags: [],
  });
  b.setPersona('# Persona\nAtlas.');
  b.addMcpFromCatalog('github');
  return b.toBundle();
}

async function signedFile(dir: string): Promise<string> {
  const kp = await generateKeypair();
  const file = join(dir, 'dev.uniqent');
  writeFileSync(file, await pack(await sign(brain(), kp.privateKey)));
  return file;
}

const BIN = fileURLToPath(new URL('../src/bin.ts', import.meta.url));
const PKG = fileURLToPath(new URL('..', import.meta.url));

/** Run the real bin with piped (non-TTY) stdin, as `echo y | uniqent …` would. */
function runBin(args: string[], input: string): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx', BIN, ...args], {
    input,
    encoding: 'utf8',
    cwd: PKG,
  });
  return { status: r.status, stderr: r.stderr };
}

describe('cli hardening', () => {
  it('non-TTY stdin: fails with an actionable message instead of prompting', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const file = await signedFile(dir);
      const noCred = runBin(['install', file, '--root', root], 'y\n');
      expect(noCred.status).toBe(1);
      expect(noCred.stderr).toContain('missing credential "github_pat" (pass --cred github_pat=');
      const noYes = runBin(['install', file, '--root', root, '--cred', 'github_pat=x'], 'y\n');
      expect(noYes.status).toBe(1);
      expect(noYes.stderr).toContain('re-run with --yes');
      expect(existsSync(join(root, '.mcp.json'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('an invalid (tampered) signature hard-fails even with --allow-unsigned', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const kp = await generateKeypair();
      const signed = await sign(brain(), kp.privateKey);
      const tampered = Bundle.fromFiles(new Map(signed.entries()));
      tampered.set(PATHS.persona, '# Persona\nEvil.');
      const file = join(dir, 'tampered.uniqent');
      writeFileSync(file, await pack(tampered));
      const { io, errs } = capture();
      const args = ['install', file, '--root', root, '--cred', 'github_pat=x', '--yes'];
      expect(await run([...args, '--allow-unsigned'], io)).toBe(1);
      expect(errs.join('\n')).toContain('signature is INVALID');
      expect(existsSync(join(root, 'AGENTS.md'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('shows the signer fingerprint and each MCP endpoint in the plan', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const file = await signedFile(dir);
      const { io, logs } = capture();
      expect(await run(['install', file, '--root', root, '--dry-run'], io)).toBe(0);
      const out = logs.join('\n');
      expect(out).toMatch(/signed by key [0-9a-f]{16} /);
      expect(out).toMatch(/github {2}streamable-http https:\/\//);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts --flag=value and rejects unknown or value-less flags', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const file = await signedFile(dir);
      const ok = capture();
      expect(
        await run(
          [
            'install',
            file,
            '--target=claude-code',
            `--root=${root}`,
            '--cred=github_pat=x',
            '--yes',
          ],
          ok.io,
        ),
      ).toBe(0);
      expect(existsSync(join(root, '.mcp.json'))).toBe(true);

      const unknown = capture();
      expect(await run(['install', file, '--bogus'], unknown.io)).toBe(1);
      expect(unknown.errs.join('\n')).toContain('unknown flag --bogus');

      const noValue = capture();
      expect(await run(['install', file, '--target'], noValue.io)).toBe(1);
      expect(noValue.errs.join('\n')).toContain('--target needs a value');

      const badCred = capture();
      expect(await run(['install', file, '--cred', 'github_pat'], badCred.io)).toBe(1);
      expect(badCred.errs.join('\n')).toContain('--cred expects <ref>=<value>');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('--help exits 0 with no side effects (keygen writes nothing, logout keeps the token)', async () => {
    const dir = tmp();
    const prev = process.env.UNIQENT_CONFIG_DIR;
    process.env.UNIQENT_CONFIG_DIR = dir;
    try {
      const key = join(dir, 'k.json');
      const h = capture();
      expect(await run(['keygen', '-o', key, '--help'], h.io)).toBe(0);
      expect(h.logs.join('\n')).toContain('usage: uniqent keygen');
      expect(existsSync(key)).toBe(false);

      await saveToken('https://uniqent.ai', 't');
      expect(await run(['logout', '--help'], capture().io)).toBe(0);
      expect(await loadToken('https://uniqent.ai')).toBe('t');

      expect(await run(['--help'], capture().io)).toBe(0);
      expect(await run(['--version'], capture().io)).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.UNIQENT_CONFIG_DIR;
      else process.env.UNIQENT_CONFIG_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses plain-http downloads except loopback', async () => {
    const orig = globalThis.fetch;
    let fetched = false;
    try {
      globalThis.fetch = (async () => {
        fetched = true;
        return new Response('x');
      }) as typeof fetch;
      const { io, errs } = capture();
      expect(await run(['inspect', 'http://example.com/dev.uniqent'], io)).toBe(1);
      expect(errs.join('\n')).toContain('refusing insecure URL http://example.com/dev.uniqent');
      expect(fetched).toBe(false);
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('checks every redirect hop: refuses one to plain http, caps loops, follows safe ones', async () => {
    const dir = tmp();
    const bytes = readFileSync(await signedFile(dir));
    const server = createServer((req, res) => {
      const location: Record<string, string> = {
        '/insecure': 'http://example.com/dev.uniqent',
        '/loop': '/loop',
        '/safe': '/dev.uniqent',
      };
      const to = location[req.url ?? ''];
      if (to) res.writeHead(302, { location: to }).end();
      else res.writeHead(200).end(bytes);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const insecure = capture();
      expect(await run(['inspect', `${base}/insecure`], insecure.io)).toBe(1);
      expect(insecure.errs.join('\n')).toContain(
        'refusing insecure URL http://example.com/dev.uniqent',
      );
      const loop = capture();
      expect(await run(['inspect', `${base}/loop`], loop.io)).toBe(1);
      expect(loop.errs.join('\n')).toContain('more than 5 redirects');
      expect(await run(['inspect', `${base}/safe`], capture().io)).toBe(0);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keygen writes the private key owner-only (0600)', async () => {
    const dir = tmp();
    try {
      const key = join(dir, 'k.json');
      expect(await run(['keygen', '-o', key], capture().io)).toBe(0);
      expect(statSync(key).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('unsupported spec version', () => {
  it('tells the user to upgrade uniqent when a bundle declares a newer specVersion', async () => {
    const { readableMessage } = await import('../src/display');
    const b = brain();
    b.set(PATHS.manifest, JSON.stringify({ ...b.manifest(), specVersion: '0.2' }));
    let message = '';
    try {
      b.manifest();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(readableMessage(message)).toEqual([
      'unsupported spec version "0.2" (this uniqent reads "0.1"); upgrade uniqent',
    ]);
  });
});
