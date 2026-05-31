import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Brain } from '@uniqent/builder';
import { generateKeypair, sign, pack } from '@uniqent/core';
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
