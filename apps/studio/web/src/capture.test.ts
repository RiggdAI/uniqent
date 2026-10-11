import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromBase64, toBase64 } from './bytes';
import { captureAgent, routeDrop } from './capture';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b64: string) => new TextDecoder().decode(fromBase64(b64));

/** The in-memory disk the fake Rust commands read (absolute path → bytes). */
let disk: Map<string, Uint8Array>;
let loaded: Array<{ path: string; bytesBase64: string }> | null;
/** read_inputs refuses this path as Rust does for a symlinked entry (names the path only). */
let symlinked: string | null;

const DROPPED = ['memory/profile.json: field "x" is empty; not loaded'];

const commands: Record<string, (args: Record<string, unknown>) => unknown> = {
  framework_homes: () => ({
    home: '/home/u',
    targets: [{ id: 'openclaw', root: '/home/u/.openclaw', present: true, error: null }],
    claudeCodeUser: false,
  }),
  read_inputs: (a) => {
    const root = a.root as string;
    if (symlinked?.startsWith(`${root}/`)) throw `refusing ${symlinked}: it is a symlink`;
    const files = (a.files as string[]).filter((p) => disk.has(`${root}/${p}`));
    const found = (a.finds as Array<{ dir: string; fileName: string }>).flatMap((f) =>
      [...disk.keys()]
        .filter((k) => k.startsWith(`${root}/${f.dir}/`) && k.endsWith(`/${f.fileName}`))
        .map((k) => k.slice(root.length + 1)),
    );
    return [...files, ...found].map((path) => ({
      path,
      bytesBase64: toBase64(disk.get(`${root}/${path}`)!),
    }));
  },
  load_bundle_files: (a) => {
    loaded = a.files as Array<{ path: string; bytesBase64: string }>;
    return { state: { manifest: { name: 'captured-openclaw-agent' } }, dropped: DROPPED };
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

beforeEach(() => {
  disk = new Map([
    ['/home/u/.openclaw/workspace/SOUL.md', enc('# Claw\n\nA careful agent.\n')],
    ['/home/u/.openclaw/workspace/MEMORY.md', enc('- prefers pnpm\n- Episodic: met Bob\n')],
  ]);
  loaded = null;
  symlinked = null;
});

describe('captureAgent (pure capture over the Rust I/O commands)', () => {
  it('loads the captured brain without episodic memory and reports what it left out', async () => {
    const result = await captureAgent('openclaw', '/home/u/.openclaw');
    const paths = loaded!.map((f) => f.path);
    expect(paths).not.toContain('memory/episodic.jsonl');
    const facts = dec(loaded!.find((f) => f.path === 'memory/facts.jsonl')!.bytesBase64);
    expect(facts).toContain('prefers pnpm');
    expect(facts).not.toContain('met Bob');
    expect(result.removed).toEqual({ episodic: 1, personal: 0 });
    expect(result.dropped).toEqual(DROPPED);
    expect(result.state.manifest.name).toBe('captured-openclaw-agent');
  });

  it('refuses a capture holding a likely secret before loading anything', async () => {
    disk.set(
      '/home/u/.openclaw/workspace/MEMORY.md',
      enc('- deploy token ghp_0123456789abcdefghijklmnopqrstuvwx\n'),
    );
    await expect(captureAgent('openclaw', '/home/u/.openclaw')).rejects.toThrow(
      /likely secret.*github-pat/,
    );
    expect(loaded).toBeNull();
  });

  it('refuses to replace the brain with an empty capture (only episodic memory found)', async () => {
    disk = new Map([['/home/u/.openclaw/workspace/MEMORY.md', enc('- Episodic: met Bob\n')]]);
    await expect(captureAgent('openclaw', '/home/u/.openclaw')).rejects.toThrow(
      /found nothing to capture from OpenClaw at \/home\/u\/\.openclaw/,
    );
    expect(loaded).toBeNull();
  });

  it("surfaces Rust's symlink refusal, naming the path, before loading anything", async () => {
    symlinked = '/home/u/.openclaw/workspace/MEMORY.md';
    await expect(captureAgent('openclaw', '/home/u/.openclaw')).rejects.toThrow(
      'refusing /home/u/.openclaw/workspace/MEMORY.md: it is a symlink',
    );
    expect(loaded).toBeNull();
  });
});

describe('routeDrop', () => {
  it('opens a single .uniqent file', () => {
    expect(routeDrop([{ path: '/x/a.uniqent', kind: 'file' }])).toEqual({
      kind: 'open-bundle',
      path: '/x/a.uniqent',
    });
  });

  it('offers vault import or capture for a single folder', () => {
    expect(routeDrop([{ path: '/x/vault', kind: 'dir' }])).toEqual({
      kind: 'choose-vault-or-capture',
      dir: '/x/vault',
    });
  });

  it('refuses anything else', () => {
    expect(routeDrop([{ path: '/x/a.txt', kind: 'file' }])).toEqual({ kind: 'unsupported' });
    expect(
      routeDrop([
        { path: '/x/a.uniqent', kind: 'file' },
        { path: '/x/vault', kind: 'dir' },
      ]),
    ).toEqual({ kind: 'unsupported' });
    expect(routeDrop([])).toEqual({ kind: 'unsupported' });
  });
});
