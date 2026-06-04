import { describe, it, expect } from 'vitest';
import { Bundle } from '../src/bundle';
import { scanForSecrets } from '../src/secret-scan';
import { makeValidBundle } from './helpers';

describe('scanForSecrets', () => {
  it('finds nothing in a clean bundle', () => {
    expect(scanForSecrets(makeValidBundle())).toHaveLength(0);
  });

  it('detects an OpenAI-style key', () => {
    const b = Bundle.empty();
    b.set('notes.md', 'token: sk-abcdefghijklmnopqrstuvwxyz0123456789');
    const f = scanForSecrets(b);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].kind).toBe('openai');
  });

  it('detects a GitHub PAT, Slack token, AWS key, and PEM block', () => {
    const b = Bundle.empty();
    b.set('a.md', 'ghp_0123456789abcdefghijklmnopqrstuvwx');
    b.set('b.md', 'xoxb-0123456789-abcdefghij');
    b.set('c.md', 'AKIAIOSFODNN7EXAMPLE');
    b.set('d.md', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----');
    const kinds = scanForSecrets(b).map((x) => x.kind);
    expect(kinds).toContain('github-pat');
    expect(kinds).toContain('slack');
    expect(kinds).toContain('aws-access-key');
    expect(kinds).toContain('private-key');
  });

  it('detects a high-entropy token', () => {
    const b = Bundle.empty();
    b.set('a.md', 'value=Zk9Q2hVx7Lm4Tp8Rb1Nc6Yd3Wf0Gj5Hs2Aq8Eu4Iv');
    expect(scanForSecrets(b).some((x) => x.kind === 'high-entropy')).toBe(true);
  });

  it('does not flag long natural identifiers / URL paths (single-case, no digits)', () => {
    const b = Bundle.empty();
    b.set(
      'skills/seo/SKILL.md',
      [
        'Use dataforseo_labs_google_competitors_domain and dataforseo_labs_bulk_keyword_difficulty.',
        'See https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
        'Refs live at skills/seo-geo/references/google-ai-optimization-guide.',
        'An all-caps constant: DATAFORSEO_LABS_BULK_TRAFFIC_ESTIMATION.',
      ].join('\n'),
    );
    expect(scanForSecrets(b)).toHaveLength(0);
  });

  it('allows ${credentialRef:...} placeholders', () => {
    const b = Bundle.empty();
    b.set('mcp/servers.json', JSON.stringify({ token: '${credentialRef:github_pat}' }));
    expect(scanForSecrets(b)).toHaveLength(0);
  });

  it('skips signature.json and allowlists author.pubkey', () => {
    const b = Bundle.empty();
    b.set(
      'signature.json',
      JSON.stringify({ signature: 'A'.repeat(88), publicKey: 'B'.repeat(64) }),
    );
    b.set('uniqent.json', JSON.stringify({ author: { name: 'x', pubkey: 'deadbeef'.repeat(8) } }));
    expect(scanForSecrets(b)).toHaveLength(0);
  });
});
