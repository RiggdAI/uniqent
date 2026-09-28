import { describe, it, expect } from 'vitest';
import { skillNameFor, fetchSkillMd, type FetchFn } from '../src/hubs/index';

describe('skillNameFor', () => {
  it('prefers the SKILL.md frontmatter name', () => {
    expect(skillNameFor('https://example.com/x/SKILL.md', '---\nname: "triage"\n---\nbody')).toBe(
      'triage',
    );
  });

  it('falls back to the directory, never the git ref', () => {
    expect(
      skillNameFor('https://raw.githubusercontent.com/acme/tools/HEAD/review/SKILL.md', 'no fm'),
    ).toBe('review');
    expect(
      skillNameFor('https://raw.githubusercontent.com/acme/code-review/HEAD/SKILL.md', 'no fm'),
    ).toBe('code-review');
  });

  it('throws when nothing names the skill', () => {
    expect(() => skillNameFor('https://example.com/SKILL.md', 'no fm')).toThrow(
      /cannot name the skill/,
    );
  });
});

describe('fetchSkillMd', () => {
  it('rejects non-https URLs before fetching', async () => {
    let called = false;
    const f: FetchFn = async () => {
      called = true;
      return new Response('x');
    };
    await expect(fetchSkillMd(f, 'http://example.com/SKILL.md', undefined)).rejects.toThrow(
      /https/,
    );
    expect(called).toBe(false);
  });

  it('allows plain http only to loopback (local development)', async () => {
    const f: FetchFn = async () => new Response('local');
    await expect(fetchSkillMd(f, 'http://127.0.0.1:9/SKILL.md', undefined)).resolves.toBe('local');
    await expect(fetchSkillMd(f, 'file:///etc/passwd', undefined)).rejects.toThrow(/https/);
  });

  it('names the URL and status on a non-2xx', async () => {
    const f: FetchFn = async () => new Response('nope', { status: 404 });
    await expect(fetchSkillMd(f, 'https://example.com/SKILL.md', undefined)).rejects.toThrow(
      /404.*example\.com/,
    );
  });

  it('returns the SKILL.md text', async () => {
    const f: FetchFn = async () => new Response('---\nname: x\n---\n');
    await expect(fetchSkillMd(f, 'https://example.com/SKILL.md', undefined)).resolves.toBe(
      '---\nname: x\n---\n',
    );
  });
});
