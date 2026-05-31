import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '@uniqent/builder';
import { generateKeypair, sign, pack, writeDir } from '@uniqent/core';
import { run, type CliIo } from '../src/run';

function capture(): { io: CliIo; logs: string[]; errs: string[] } {
  const logs: string[] = [];
  const errs: string[] = [];
  return { io: { log: (m) => logs.push(m), error: (m) => errs.push(m) }, logs, errs };
}

async function makeBundleFile(dir: string, signed: boolean): Promise<string> {
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
  b.addSkill('code-review', '---\nname: code-review\n---\nReview code.\n');
  let bundle = b.toBundle();
  if (signed) {
    const kp = await generateKeypair();
    bundle = await sign(bundle, kp.privateKey);
  }
  const file = join(dir, signed ? 'dev.uniqent' : 'dev-unsigned.uniqent');
  writeFileSync(file, await pack(bundle));
  return file;
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'uniqent-cli-'));
}

describe('uniqent cli', () => {
  it('inspect prints a summary with signature status', async () => {
    const dir = tmp();
    try {
      const file = await makeBundleFile(dir, true);
      const { io, logs } = capture();
      const code = await run(['inspect', file], io);
      expect(code).toBe(0);
      const out = logs.join('\n');
      expect(out).toContain('Dev');
      expect(out).toContain('signature: valid');
      expect(out).toContain('github_pat');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates and packs a bundle directory', async () => {
    const dir = tmp();
    try {
      const b = Brain.create({
        name: 'demo',
        displayName: 'Demo',
        version: '0.1.0',
        description: 'd',
        author: { name: 'me' },
        license: 'CC0-1.0',
        tags: [],
      });
      b.setPersona('# Persona\n');
      b.addMcpFromCatalog('github');
      b.addSkill('code-review', '---\nname: code-review\n---\nReview.\n');
      await writeDir(b.toBundle(), dir);

      const v = capture();
      expect(await run(['validate', dir], v.io)).toBe(0);
      expect(v.logs.join('\n')).toContain('valid');

      const out = join(dir, 'demo.uniqent');
      const p = capture();
      expect(await run(['pack', dir, '-o', out], p.io)).toBe(0);
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installs from an http(s) URL', async () => {
    const dir = tmp();
    const root = tmp();
    const orig = globalThis.fetch;
    try {
      const file = await makeBundleFile(dir, true);
      const bytes = readFileSync(file);
      globalThis.fetch = (async () => new Response(bytes)) as typeof fetch;
      const { io } = capture();
      const code = await run(
        [
          'install',
          'https://example.com/dev.uniqent',
          '--target',
          'claude-code',
          '--root',
          root,
          '--cred',
          'github_pat=ghp_x',
          '--yes',
        ],
        io,
      );
      expect(code).toBe(0);
      expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    } finally {
      globalThis.fetch = orig;
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('install writes Claude Code files with the resolved credential', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const file = await makeBundleFile(dir, true);
      const { io } = capture();
      const code = await run(
        [
          'install',
          file,
          '--target',
          'claude-code',
          '--root',
          root,
          '--cred',
          'github_pat=ghp_demo000111222333444',
          '--yes',
        ],
        io,
      );
      expect(code).toBe(0);
      expect(existsSync(join(root, '.claude/skills/code-review/SKILL.md'))).toBe(true);
      expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain('Atlas');
      const mcp = JSON.parse(readFileSync(join(root, '.mcp.json'), 'utf8'));
      expect(mcp.mcpServers.github.headers.Authorization).toContain('ghp_demo000111222333444');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('install --target hermes writes Hermes files', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const file = await makeBundleFile(dir, true);
      const { io } = capture();
      const code = await run(
        [
          'install',
          file,
          '--target',
          'hermes',
          '--root',
          root,
          '--cred',
          'github_pat=ghp_demo000111222333444',
          '--yes',
        ],
        io,
      );
      expect(code).toBe(0);
      expect(existsSync(join(root, 'SOUL.md'))).toBe(true);
      expect(existsSync(join(root, 'hermes.json'))).toBe(true);
      expect(readFileSync(join(root, '.env'), 'utf8')).toContain(
        'GITHUB_PAT=ghp_demo000111222333444',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('install fails when a required credential is missing', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const file = await makeBundleFile(dir, true);
      const { io, errs } = capture();
      const code = await run(['install', file, '--root', root, '--yes'], io);
      expect(code).toBe(1);
      expect(errs.join('\n')).toContain('missing credential');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('search lists matching bundles from a registry index', async () => {
    const orig = globalThis.fetch;
    const index = {
      bundles: [
        {
          name: 'dev',
          version: '0.1.0',
          description: 'a coding agent',
          tags: ['coding'],
          url: 'https://x/dev.uniqent',
        },
        {
          name: 'writer',
          version: '0.2.0',
          description: 'prose helper',
          tags: ['writing'],
          url: 'https://x/writer.uniqent',
        },
      ],
    };
    try {
      globalThis.fetch = (async () => new Response(JSON.stringify(index))) as typeof fetch;
      const { io, logs } = capture();
      const code = await run(['search', 'coding', '--registry', 'https://r/index.json'], io);
      expect(code).toBe(0);
      const out = logs.join('\n');
      expect(out).toContain('dev@0.1.0');
      expect(out).not.toContain('writer@');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('search errors without a registry', async () => {
    const { io, errs } = capture();
    expect(await run(['search', 'x'], io)).toBe(1);
    expect(errs.join('\n')).toContain('no registry');
  });

  it('installs by registry slug (index → url → install)', async () => {
    const dir = tmp();
    const root = tmp();
    const orig = globalThis.fetch;
    try {
      const file = await makeBundleFile(dir, true);
      const bytes = readFileSync(file);
      const index = {
        bundles: [{ name: 'dev', version: '0.1.0', url: 'https://x/dev.uniqent' }],
      };
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input);
        return url.endsWith('index.json')
          ? new Response(JSON.stringify(index))
          : new Response(bytes);
      }) as typeof fetch;
      const { io } = capture();
      const code = await run(
        [
          'install',
          'dev',
          '--registry',
          'https://r/index.json',
          '--target',
          'claude-code',
          '--root',
          root,
          '--cred',
          'github_pat=ghp_x',
          '--yes',
        ],
        io,
      );
      expect(code).toBe(0);
      expect(existsSync(join(root, '.mcp.json'))).toBe(true);
    } finally {
      globalThis.fetch = orig;
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('install by slug errors when no registry is configured', async () => {
    const root = tmp();
    try {
      const { io, errs } = capture();
      const code = await run(['install', 'dev', '--root', root, '--yes'], io);
      expect(code).toBe(1);
      expect(errs.join('\n')).toContain('registry slug');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('hub mcp searches the registry + smithery and lists results', async () => {
    const orig = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: unknown) => {
        const url = String(input);
        if (url.includes('registry.modelcontextprotocol.io')) {
          return new Response(
            JSON.stringify({
              servers: [
                {
                  server: {
                    name: 'io.example/web',
                    description: 'web tools',
                    remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
                  },
                  _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
                },
              ],
            }),
          );
        }
        // Smithery
        return new Response(
          JSON.stringify({
            servers: [
              {
                qualifiedName: 'acme/db',
                displayName: 'DB',
                description: 'database',
                useCount: 99,
              },
            ],
          }),
        );
      }) as typeof fetch;
      const { io, logs } = capture();
      const code = await run(['hub', 'mcp', 'web'], io);
      expect(code).toBe(0);
      const out = logs.join('\n');
      expect(out).toContain('io-example-web');
      expect(out).toContain('[mcp-registry]');
      expect(out).toContain('acme-db');
      expect(out).toContain('[smithery]');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('hub skills lists GitHub repos and isolates a down hub', async () => {
    const orig = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                full_name: 'acme/triage-skill',
                description: 'triage',
                stargazers_count: 7,
              },
            ],
          }),
        )) as typeof fetch;
      const { io, logs } = capture();
      const code = await run(['hub', 'skills', 'triage'], io);
      expect(code).toBe(0);
      const out = logs.join('\n');
      expect(out).toContain('triage-skill');
      expect(out).toContain('[github]');
      expect(out).toContain('SKILL.md: https://raw.githubusercontent.com/acme/triage-skill');
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('hub with no kind prints usage and fails', async () => {
    const { io, errs } = capture();
    expect(await run(['hub'], io)).toBe(1);
    expect(errs.join('\n')).toContain('hub <mcp|skills>');
  });

  it('install refuses an unsigned bundle unless --allow-unsigned', async () => {
    const dir = tmp();
    const root = tmp();
    try {
      const file = await makeBundleFile(dir, false);
      const refused = capture();
      expect(
        await run(['install', file, '--root', root, '--cred', 'github_pat=x', '--yes'], refused.io),
      ).toBe(1);
      expect(refused.errs.join('\n')).toContain('unsigned');

      const allowed = capture();
      expect(
        await run(
          [
            'install',
            file,
            '--root',
            root,
            '--cred',
            'github_pat=ghp_x',
            '--allow-unsigned',
            '--yes',
          ],
          allowed.io,
        ),
      ).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
