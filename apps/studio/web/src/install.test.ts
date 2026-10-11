import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Brain } from '@uniqent/builder/brain';
import { fromBase64, toBase64 } from './bytes';
import { applyInstall, BrainInvalidError, planInstall, previewInstall } from './install';

const enc = (s: string) => new TextEncoder().encode(s);

interface WriteCall {
  root: string;
  writes: Array<{ path: string; bytesBase64: string; mode: number | null }>;
}

/** The in-memory disk the fake Rust commands read and write (absolute path → bytes). */
let disk: Map<string, Uint8Array>;
let readCalls: string[];
let writeCalls: WriteCall[];
let bundleFiles: Array<{ path: string; bytesBase64: string }>;

const lastWrites = () => writeCalls[writeCalls.length - 1]!.writes;
const writeCallRoots = () => writeCalls.map((c) => c.root);

function brain(): Brain {
  const b = Brain.create({
    name: 'install-brain',
    displayName: 'Install Brain',
    version: '0.1.0',
    description: 'Studio install test',
    author: { name: 'test' },
    license: 'CC0-1.0',
    tags: [],
  });
  b.setPersona('# Persona\n\nHelpful.\n');
  b.addSkill('triage', '---\nname: triage\ndescription: Triage issues\n---\nTriage.\n');
  b.addMcpFromCatalog('github');
  b.addChannelFromCatalog('telegram');
  return b;
}

function filesOf(b: Brain): Array<{ path: string; bytesBase64: string }> {
  return [...b.toBundle().entries()].map(([path, bytes]) => ({
    path,
    bytesBase64: toBase64(bytes),
  }));
}

/** Declares a persona in the manifest but drops identity/persona.md: validateBundle refuses it. */
function invalidBrainFiles(): Array<{ path: string; bytesBase64: string }> {
  return filesOf(brain()).filter((f) => f.path !== 'identity/persona.md');
}

/** A draft whose persona holds a GitHub token: the secret scan must refuse to install it. */
function secretBrainFiles(): Array<{ path: string; bytesBase64: string }> {
  const b = brain();
  b.setPersona('Use ghp_0123456789abcdefghijklmnopqrstuvwx for GitHub.');
  return filesOf(b);
}

/** Every file under `root/dir` named `fileName`, skipping dot segments and `skipDirs` (Rust walk). */
function find(root: string, f: { dir: string; fileName: string; skipDirs: string[] }) {
  const prefix = `${root}/${f.dir}/`;
  return [...disk.keys()]
    .filter((k) => k.startsWith(prefix) && k.endsWith(`/${f.fileName}`))
    .filter((k) =>
      k
        .slice(prefix.length)
        .split('/')
        .every((seg) => !seg.startsWith('.') && !f.skipDirs.includes(seg)),
    )
    .map((k) => k.slice(root.length + 1));
}

const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
  bundle_files: () => bundleFiles,
  framework_homes: () => ({
    home: '/home/u',
    targets: [
      { id: 'hermes', root: '/home/u/.hermes', present: true, error: null },
      { id: 'openclaw', root: '/home/u/.openclaw', present: true, error: null },
    ],
    claudeCodeUser: false,
  }),
  read_inputs: (a) => {
    const root = a.root as string;
    readCalls.push(root);
    const files = (a.files as string[]).filter((p) => disk.has(`${root}/${p}`));
    const found = (a.finds as Array<{ dir: string; fileName: string; skipDirs: string[] }>).flatMap(
      (f) => find(root, f),
    );
    return [...new Set([...files, ...found])].map((path) => ({
      path,
      bytesBase64: toBase64(disk.get(`${root}/${path}`)!),
    }));
  },
  write_outputs: (a) => {
    const call = { root: a.root as string, writes: a.writes as WriteCall['writes'] };
    writeCalls.push(call);
    for (const w of call.writes) disk.set(`${call.root}/${w.path}`, fromBase64(w.bytesBase64));
    return call.writes.map((w) => w.path);
  },
};

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    const handler = commands[cmd];
    if (!handler) throw `unexpected command ${cmd}`;
    return handler(args ?? {});
  },
}));
vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: () => Promise.reject(new Error('no network')),
}));

const creds = { github_pat: 'v1', telegram_bot_token: 'v2' };

beforeEach(() => {
  disk = new Map();
  readCalls = [];
  writeCalls = [];
  bundleFiles = filesOf(brain());
  vi.restoreAllMocks();
});

describe('Studio install (pure adapters over the Rust I/O commands)', () => {
  it('plans Hermes without writing, then writes .env owner-only with the typed credential', async () => {
    const plan = await planInstall('hermes', '/home/u/.hermes');
    expect(writeCalls).toHaveLength(0);
    expect(plan.requiresCredentials).toEqual(['github_pat', 'telegram_bot_token']);
    await applyInstall('hermes', '/home/u/.hermes', { github_pat: 'v1', telegram_bot_token: 'v2' });
    const env = lastWrites().find((w) => w.path === '.env');
    expect(env?.mode).toBe(0o600);
    expect(new TextDecoder().decode(fromBase64(env!.bytesBase64))).toContain('GITHUB_PAT=v1');
  });

  it('previews a replaced .env value before writing anything', async () => {
    disk.set('/home/u/.hermes/.env', enc('GITHUB_PAT=old\n'));
    const t = await previewInstall('hermes', '/home/u/.hermes', {
      github_pat: 'v1',
      telegram_bot_token: 'v2',
    });
    expect(writeCalls).toHaveLength(0);
    expect(t.notes).toContain(
      'transformed: .env — replaces your existing, different value of GITHUB_PAT.',
    );
  });

  it('never logs a credential value', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k),
    );
    await applyInstall('openclaw', '/home/u/.openclaw', {
      github_pat: 'S3CRET',
      telegram_bot_token: 'T0KEN',
    });
    expect(writeCalls.length).toBeGreaterThan(0);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toMatch(/S3CRET|T0KEN/);
  });

  it('refuses an invalid draft before reading anything', async () => {
    bundleFiles = invalidBrainFiles();
    await expect(planInstall('claude-code', '/p')).rejects.toThrow(BrainInvalidError);
    await expect(planInstall('claude-code', '/p')).rejects.toThrow(/brain is invalid/);
    expect(readCalls).toHaveLength(0);
  });

  it('refuses to install a draft holding a secret (fail-closed scan) before reading or writing', async () => {
    bundleFiles = secretBrainFiles();
    await expect(applyInstall('claude-code', '/p', creds)).rejects.toThrow(
      /brain is invalid; fix it before installing: possible github-pat secret/,
    );
    expect(readCalls).toHaveLength(0);
    expect(writeCalls).toHaveLength(0);
  });

  it('writes an OpenClaw workspace outside the state dir with its own root', async () => {
    disk.set(
      '/home/u/.openclaw/openclaw.json',
      enc(JSON.stringify({ agents: { defaults: { workspace: '~/clawd' } } })),
    );
    await applyInstall('openclaw', '/home/u/.openclaw', creds);
    expect(writeCallRoots()).toEqual(['/home/u/clawd', '/home/u/.openclaw']);
  });

  it('reports written paths relative to the root and the adapter notes', async () => {
    const result = await applyInstall('claude-code', '/p', creds);
    expect(result.written).toContain('AGENTS.md');
    expect(result.written).toContain('.claude/skills/triage/SKILL.md');
    expect(result.notes.length).toBeGreaterThan(0);
  });
});

describe('bytes', () => {
  it('round-trips bytes across the 32 KiB chunk boundary', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});
