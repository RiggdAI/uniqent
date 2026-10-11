import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain } from '@uniqent/builder';
import { pack, unpack, type Bundle } from '@uniqent/core';
import { run, type CliIo } from '@uniqent/cli';

export type FixtureTarget = 'claude-code' | 'hermes' | 'openclaw';

/** One target's golden install/capture, all paths POSIX and relative to the install root. */
export interface InstallFixture {
  target: FixtureTarget;
  /** Files present before the install (path → UTF-8 text). Seeds exercise every merge path. */
  seed: Record<string, string>;
  /** Dummy credential values passed as `--cred ref=value` (not secret-shaped). */
  credentials: Record<string, string>;
  /** Every file after `uniqent install` (path → bytes, and whether its mode is owner-only). */
  tree: Record<string, { bytesBase64: string; ownerOnly: boolean }>;
  /** `uniqent export --from <target>` of that tree: bundle path → base64 bytes. */
  captured: Record<string, string>;
}

const CREATED_AT = '2026-05-31T00:00:00.000Z';

/** Deterministic brain that touches every component the adapters translate. */
export function fixtureBundle(): Bundle {
  const brain = Brain.create({
    name: 'parity-brain',
    displayName: 'Parity Brain',
    version: '0.1.0',
    description: 'Install parity fixture',
    author: { name: 'fixture' },
    license: 'CC0-1.0',
    tags: [],
  });
  brain.setPersona('# Persona\n\nA precise, friendly assistant.\n');
  brain.setPolicies('# Policies\n\nNever guess.\n');
  brain.setProfile({ name: 'Ada', role: 'Lead' });
  brain.addMemory({
    id: 'f1',
    kind: 'fact',
    text: 'Prefers TypeScript',
    createdAt: CREATED_AT,
    importance: 1,
  });
  brain.addMemory({
    id: 'f2',
    kind: 'fact',
    text: 'Deploys on Fridays',
    createdAt: CREATED_AT,
    importance: 0.5,
  });
  brain.addMemory({
    id: 'f3',
    kind: 'fact',
    text: 'Likes terse answers',
    createdAt: CREATED_AT,
    importance: 0,
  });
  brain.addMemory({
    id: 'e1',
    kind: 'episodic',
    text: 'Said hello on day one',
    createdAt: CREATED_AT,
  });
  brain.addSkill(
    'triage',
    '---\nname: triage\ndescription: Triage incoming issues\n---\nTriage issues.\n',
    { 'assets/logo.bin': new Uint8Array([0, 255, 1, 128]) },
  );
  brain.addMcpFromCatalog('github');
  brain.addChannelFromCatalog('telegram');
  brain.addTask({
    id: 'daily',
    name: 'Daily briefing',
    trigger: { type: 'schedule', cron: '0 9 * * *' },
    action: { kind: 'prompt', prompt: 'Summarise yesterday.' },
    enabled: true,
  });
  return brain.toBundle();
}

const SEEDS: Record<FixtureTarget, Record<string, string>> = {
  'claude-code': {
    'AGENTS.md': '# My agents\n\nUser-written text.\n',
    'CLAUDE.md': '# Claude\n\nUser-written claude notes.\n',
    '.mcp.json':
      JSON.stringify({ mcpServers: { other: { command: 'echo', args: ['hi'] } } }, null, 2) + '\n',
  },
  hermes: {
    'config.yaml': '# keep this comment\nmodel: some-model\n',
    '.env': 'EXISTING=1\n',
    'memories/MEMORY.md': 'First existing entry\n§\nSecond existing entry\n',
    'SOUL.md': 'User soul text.\n',
  },
  openclaw: {
    'openclaw.json': '{\n  // keep this comment\n  gateway: { port: 18789 },\n}\n',
    '.env': 'EXISTING=1\n',
    'workspace/SOUL.md': 'User soul text.\n',
  },
};

const toPosix = (p: string): string => p.split(sep).join('/');

async function listFiles(root: string, dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? listFiles(root, join(dir, e.name))
        : [toPosix(relative(root, join(dir, e.name)))],
    ),
  );
  return nested.flat().sort();
}

async function snapshot(root: string): Promise<InstallFixture['tree']> {
  const entries = await Promise.all(
    (await listFiles(root, root)).map(async (path) => {
      const abs = join(root, path);
      const [bytes, st] = await Promise.all([readFile(abs), stat(abs)]);
      return [
        path,
        { bytesBase64: bytes.toString('base64'), ownerOnly: (st.mode & 0o077) === 0 },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** Install the fixture bundle into a seeded sandbox via the real CLI, then capture it back. */
export async function buildInstallFixture(target: FixtureTarget): Promise<InstallFixture> {
  const base = await mkdtemp(join(tmpdir(), `uniqent-fixture-${target}-`));
  try {
    const root = join(base, 'root');
    const seed = SEEDS[target];
    for (const [path, text] of Object.entries(seed)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const bundleFile = join(base, 'parity.uniqent');
    const capturedFile = join(base, 'captured.uniqent');
    await writeFile(bundleFile, await pack(fixtureBundle()));

    const lines: string[] = [];
    const io: CliIo = { log: (m) => lines.push(m), error: (m) => lines.push(m) };
    const credentials = Object.fromEntries(
      fixtureBundle()
        .manifest()
        .credentials.map((c) => [c.ref, `test-${c.ref}`]),
    );
    const credArgs = Object.entries(credentials).flatMap(([ref, v]) => ['--cred', `${ref}=${v}`]);
    const installCode = await run(
      [
        'install',
        bundleFile,
        '--target',
        target,
        '--root',
        root,
        '--allow-unsigned',
        '--yes',
        ...credArgs,
      ],
      io,
    );
    if (installCode !== 0)
      throw new Error(`uniqent install --target ${target} failed:\n${lines.join('\n')}`);
    const tree = await snapshot(root);

    const exportCode = await run(
      ['export', '--from', target, '--root', root, '--out', capturedFile],
      io,
    );
    if (exportCode !== 0)
      throw new Error(`uniqent export --from ${target} failed:\n${lines.join('\n')}`);
    const capturedBundle = await unpack(new Uint8Array(await readFile(capturedFile)));
    const captured = Object.fromEntries(
      capturedBundle
        .entries()
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([path, bytes]) => [path, Buffer.from(bytes).toString('base64')]),
    );
    return { target, seed, credentials, tree, captured };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

// Only run when executed directly (not when imported by tests).
const selfPath = fileURLToPath(import.meta.url);
const isMain = process.argv[1] != null && resolve(process.argv[1]) === resolve(selfPath);

if (isMain) {
  const out = join(dirname(selfPath), '..', 'fixtures', 'install');
  await mkdir(out, { recursive: true });
  for (const target of ['claude-code', 'hermes', 'openclaw'] as const) {
    const fixture = await buildInstallFixture(target);
    await writeFile(join(out, `${target}.json`), JSON.stringify(fixture, null, 2) + '\n');
  }
  console.log('install fixtures written to', out);
}
