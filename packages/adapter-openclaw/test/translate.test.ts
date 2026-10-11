import { describe, it, expect } from 'vitest';
import { Brain } from '@uniqent/builder';
import { gatherInputs, joinPath, type ReadFiles } from '@uniqent/adapter-sdk/pure';
import { openClawPure } from '../src/pure';

const META = {
  name: 'dev',
  displayName: 'Dev',
  version: '0.1.0',
  description: 'd',
  author: { name: 'me' },
  license: 'CC0-1.0',
  tags: [],
};

function makeBundle() {
  const b = Brain.create(META);
  b.setPersona('# Persona\nClaw agent.');
  b.addMcpFromCatalog('github');
  b.addSkill('triage', '---\nname: triage\n---\nTriage.\n');
  b.addChannelFromCatalog('telegram');
  b.addMemory({ id: 'f1', kind: 'fact', text: 'a fact', createdAt: '2026-05-31T00:00:00.000Z' });
  return b.toBundle();
}

const bundle = makeBundle();
const resolved = { github_pat: 'ghp_demo000111222333444', telegram_bot_token: 'bot:secrettoken' };
const ctx = { root: '/s', home: '/home/u', cwd: '/work' };
const enc = new TextEncoder();
const config = (workspace: string) =>
  enc.encode(JSON.stringify({ agents: { defaults: { workspace } } }));

/** Settle `inputs()` against an in-memory disk. */
function gather(disk: Map<string, Uint8Array>): Promise<ReadFiles> {
  return gatherInputs(
    (r) => openClawPure.inputs(bundle, r, ctx),
    async (req) =>
      new Map(
        req.files.flatMap((f) => {
          const v = disk.get(joinPath(f.root, f.path));
          return v ? [[joinPath(f.root, f.path), v] as const] : [];
        }),
      ),
  );
}

describe('openClawPure (no disk)', () => {
  it('needs openclaw.json before it knows the workspace (two rounds)', async () => {
    const disk = new Map([['/s/openclaw.json', config('~/clawd')]]);
    const rounds: string[][] = [];
    const read = await gatherInputs(
      (r) => openClawPure.inputs(bundle, r, ctx),
      async (req) => {
        rounds.push(req.files.map((f) => `${f.root}|${f.path}`));
        return new Map(
          req.files.flatMap((f) => {
            const v = disk.get(joinPath(f.root, f.path));
            return v ? [[joinPath(f.root, f.path), v] as const] : [];
          }),
        );
      },
    );
    expect(rounds[1]).toContain('/home/u/clawd|SOUL.md');
    const t = openClawPure.translate(bundle, read, resolved, ctx);
    expect(t.writes.find((w) => w.path === 'SOUL.md')?.root).toBe('/home/u/clawd');
    expect(t.writes.find((w) => w.path === '.env')).toMatchObject({ root: '/s', mode: 0o600 });
  });

  it('roots the default workspace at the state dir', () => {
    const files = openClawPure.inputs(bundle, new Map(), ctx).files;
    expect(files).toContainEqual({ root: '/s', path: 'workspace/SOUL.md' });
    expect(files).toContainEqual({ root: '/s', path: 'workspace/skills/triage/SKILL.md' });
  });

  it('resolves a relative configured workspace against the cwd', () => {
    const read = new Map([['/s/openclaw.json', config('ws/../claw')]]);
    expect(openClawPure.inputs(bundle, read, ctx).files).toContainEqual({
      root: '/work/claw',
      path: 'MEMORY.md',
    });
  });

  it('reports replacing an existing, different skill file', async () => {
    const skill = bundle.list().find((p) => p.startsWith('skills/'))!;
    const read = await gather(new Map([[`/s/workspace/${skill}`, enc.encode('my own\n')]]));
    expect(openClawPure.plan(bundle, read, ctx).lossiness).toContainEqual({
      component: `skill ${skill}`,
      issue: 'replaces an existing, different workspace skill file.',
      action: 'transformed',
    });
  });

  it('notes replacing a different .env value right before the credentials line', async () => {
    const read = await gather(new Map([['/s/.env', enc.encode('GITHUB_PAT=old\n')]]));
    const { notes } = openClawPure.translate(bundle, read, resolved, ctx);
    expect(notes.slice(-2)).toEqual([
      'transformed: .env — replaces your existing, different value of GITHUB_PAT.',
      'credentials stored in .env (mode 0600) as GITHUB_PAT, TELEGRAM_BOT_TOKEN',
    ]);
  });

  it('captures facts and episodic notes from the workspace MEMORY.md', async () => {
    const disk = new Map([
      ['/s/workspace/MEMORY.md', enc.encode('- prefers pnpm\n- Episodic: met Bob\n')],
    ]);
    const read = await gatherInputs(
      (r) => openClawPure.captureInputs(r, ctx),
      async (req) =>
        new Map(
          req.files.flatMap((f) => {
            const v = disk.get(joinPath(f.root, f.path));
            return v ? [[joinPath(f.root, f.path), v] as const] : [];
          }),
        ),
    );
    const captured = openClawPure.capture(read, ctx);
    expect(captured.memoryFacts().map((m) => [m.id, m.text])).toEqual([['m1', 'prefers pnpm']]);
    expect(captured.memoryEpisodic().map((m) => [m.id, m.text])).toEqual([['e1', 'met Bob']]);
  });
});
