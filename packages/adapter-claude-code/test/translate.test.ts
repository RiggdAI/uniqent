import { describe, it, expect } from 'vitest';
import { Brain } from '@uniqent/builder';
import { claudeCodePure, McpConfigParseError } from '../src/pure';

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
  b.setPersona('# Persona\nAtlas, ships fast.');
  b.addMcpFromCatalog('github');
  b.addSkill('code-review', '---\nname: code-review\n---\nReview code.\n', {
    'assets/logo.bin': new Uint8Array([0, 255]),
  });
  return b.toBundle();
}

const bundle = makeBundle();
const resolved = { github_pat: 'ghp_demo000111222333444' };
const ctx = { root: '/p', home: '/home/u', cwd: '/home/u' };
const enc = new TextEncoder();
const dec = new TextDecoder();
const skillMd = bundle.get('skills/code-review/SKILL.md')!;

describe('claudeCodePure (no disk)', () => {
  it('asks for AGENTS.md, CLAUDE.md, .mcp.json and every bundle skill target, nothing else', () => {
    const req = claudeCodePure.inputs(bundle, new Map(), ctx);
    expect(req.finds).toEqual([]);
    expect(req.files).toEqual([
      { root: '/p', path: 'AGENTS.md' },
      { root: '/p', path: 'CLAUDE.md' },
      { root: '/p', path: '.mcp.json' },
      ...bundle
        .list()
        .filter((p) => p.startsWith('skills/'))
        .map((p) => ({ root: '/p', path: `.claude/${p}` })),
    ]);
  });

  it('reports replacing an existing, different skill file once, and an identical one not at all', () => {
    const component = 'skill .claude/skills/code-review/SKILL.md';
    const different = new Map([['/p/.claude/skills/code-review/SKILL.md', enc.encode('mine\n')]]);
    const loss = claudeCodePure.plan(bundle, different, ctx).lossiness;
    expect(loss.filter((l) => l.component === component)).toEqual([
      { component, action: 'transformed', issue: 'replaces an existing, different skill file.' },
    ]);
    const same = new Map([['/p/.claude/skills/code-review/SKILL.md', skillMd]]);
    expect(claudeCodePure.plan(bundle, same, ctx).lossiness.map((l) => l.component)).not.toContain(
      component,
    );
  });

  it('imports AGENTS.md from an existing CLAUDE.md and says why', () => {
    const read = new Map([['/p/CLAUDE.md', enc.encode('# Rules\nuse tabs\n')]]);
    const t = claudeCodePure.translate(bundle, read, resolved, ctx);
    expect(t.writes.map((w) => w.path)).toEqual([
      '.claude/skills/code-review/SKILL.md',
      '.claude/skills/code-review/assets/logo.bin',
      'AGENTS.md',
      'CLAUDE.md',
      '.mcp.json',
    ]);
    const claude = dec.decode(t.writes.find((w) => w.path === 'CLAUDE.md')?.bytes);
    expect(claude).toMatch(/^# Rules\nuse tabs\n\n<!-- uniqent:begin -->\n@AGENTS\.md\n/);
    expect(t.notes[0]).toMatch(/^CLAUDE\.md exists, so Claude Code would ignore AGENTS\.md; /);
  });

  it('writes .mcp.json owner-only with a do-not-commit note only when it inlines a credential', () => {
    const t = claudeCodePure.translate(bundle, new Map(), resolved, ctx);
    const mcp = t.writes.find((w) => w.path === '.mcp.json');
    expect(mcp?.mode).toBe(0o600);
    expect(dec.decode(mcp?.bytes)).toContain('Bearer ghp_demo000111222333444');
    expect(t.notes.join('\n')).toContain('do not commit');
    expect(t.writes.filter((w) => w.path !== '.mcp.json').every((w) => w.mode === null)).toBe(true);

    const plain = Brain.create(META);
    plain.addMcpFromCatalog('fetch');
    const p = claudeCodePure.translate(plain.toBundle(), new Map(), {}, ctx);
    expect(p.writes.find((w) => w.path === '.mcp.json')?.mode).toBeNull();
    expect(p.notes.join('\n')).not.toContain('do not commit');
  });

  it('throws on an unparseable .mcp.json, naming the file', () => {
    const read = new Map([['/p/.mcp.json', enc.encode('{ nope')]]);
    expect(() => claudeCodePure.plan(bundle, read, ctx)).toThrow(McpConfigParseError);
    expect(() => claudeCodePure.plan(bundle, read, ctx)).toThrow('/p/.mcp.json');
  });

  it('captures depth-1 skills and an MCP bearer credential requirement without its value', () => {
    expect(claudeCodePure.captureInputs(new Map(), ctx).finds).toEqual([
      { root: '/p', dir: '.claude/skills', fileName: 'SKILL.md', skipDirs: [] },
    ]);
    const files = new Map([
      ['/p/.claude/skills/b/SKILL.md', enc.encode('---\nname: b\n---\n')],
      ['/p/.claude/skills/a/SKILL.md', enc.encode('---\nname: a\n---\n')],
      ['/p/.claude/skills/group/inner/SKILL.md', enc.encode('---\nname: inner\n---\n')],
      [
        '/p/.mcp.json',
        enc.encode(
          JSON.stringify({
            mcpServers: {
              gh: {
                type: 'http',
                url: 'https://x/mcp',
                headers: { Authorization: 'Bearer s3cr3t' },
              },
            },
          }),
        ),
      ],
    ]);
    const captured = claudeCodePure.capture(files, ctx);
    expect(captured.skillNames()).toEqual(['a', 'b']);
    expect(captured.mcpServers()[0]?.auth).toEqual({ type: 'bearer', credentialRef: 'gh_token' });
    expect(captured.manifest().credentials.map((c) => c.ref)).toEqual(['gh_token']);
    const everything = captured
      .list()
      .map((p) => dec.decode(captured.get(p)))
      .join('\n');
    expect(everything).not.toContain('s3cr3t');
  });
});
