import { describe, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Bundle } from '../src/bundle';
import { scanForSecrets, isLikelySecretValue } from '../src/secret-scan';
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

  it('does not flag long natural identifiers / URL & file paths (broken into short words)', () => {
    const b = Bundle.empty();
    b.set(
      'skills/seo/SKILL.md',
      [
        'Use dataforseo_labs_google_competitors_domain and dataforseo_labs_bulk_keyword_difficulty.',
        'See https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
        'Refs live at skills/seo-geo/references/google-ai-optimization-guide.',
        'A mixed-case path: claude/skills/gstack/codex/SKILL.md and .factory/skills/gstack-qa.',
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

describe('isLikelySecretValue', () => {
  it('flags known-prefix and high-entropy values', () => {
    expect(isLikelySecretValue('sk-abcdefghijklmnopqrstuvwxyz0123')).toBe(true);
    expect(isLikelySecretValue('ghp_0123456789abcdefghijklmnopqrstuvwxyz')).toBe(true);
    expect(isLikelySecretValue('kJ8s0LkQ2mZ9rT4wX7bV1nC6pY3dF5gH8jL0aS2')).toBe(true);
  });
  it('does not flag placeholders or plain text', () => {
    expect(isLikelySecretValue('${credentialRef:foo_token}')).toBe(false);
    expect(isLikelySecretValue('hello world')).toBe(false);
    expect(isLikelySecretValue('')).toBe(false);
  });
});

describe('secret-scan detectors', () => {
  const hex = (n: number): string => randomBytes(n).toString('hex');
  // Fake tokens are split (prefix + body) so hosted secret scanners don't flag this test file.

  it.each([
    ['anthropic', 'sk-ant-' + 'api03-abcDEF123_-ghiJKL456mnoPQR789stuVWX'],
    ['openai', 'sk-proj-' + 'ESSpnjt-lN-YciW7j9R_U9g89MzzlCu9'],
    ['github-pat', 'github_pat_' + '11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz'],
    ['gitlab-pat', 'glpat-' + 'aB3dE6gH9jK2mN5pQ8sT'],
    ['google-api-key', 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
    ['stripe', 'sk_live_' + '4eC39HqLyjWDarjtT1zdp7dc'],
    ['stripe', 'rk_live_' + '4eC39HqLyjWDarjtT1zdp7dc'],
    ['url-credentials', 'postgres://admin:Tr0ub4dor@db.example.com/app'],
    ['private-key', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    ['private-key', '-----BEGIN PGP PRIVATE KEY BLOCK-----'],
    ['named-secret', `API_KEY=${hex(16)}`],
    ['named-secret', `token: ${hex(20)}`],
    ['named-secret', `Authorization: Bearer ${hex(32)}`],
    ['named-secret', `apiKey = "${randomUUID()}"`],
    ['named-secret', 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
  ])('detects %s', (kind, value) => {
    const b = Bundle.empty();
    b.set('notes.md', value);
    expect(scanForSecrets(b).map((f) => f.kind)).toContain(kind);
  });

  it('detects hex/UUID credentials under secret-ish JSON keys and secrets in JSON keys', () => {
    const b = Bundle.empty();
    b.set(
      'mcp/servers.json',
      JSON.stringify({ env: { GITHUB_TOKEN: hex(20), HEROKU_API_KEY: randomUUID() } }),
    );
    b.set('tools/tools.json', JSON.stringify({ ['ghp_0123456789abcdefghijklmnopqrstuvwx']: true }));
    const found = scanForSecrets(b).map((f) => `${f.path}:${f.kind}`);
    expect(found.filter((f) => f === 'mcp/servers.json:named-secret')).toHaveLength(2);
    expect(found).toContain('tools/tools.json:github-pat');
  });

  it('scans text files whatever their extension, and known formats inside binaries', () => {
    const b = Bundle.empty();
    b.set('avatar.svg', '<svg><!-- ghp_0123456789abcdefghijklmnopqrstuvwx --></svg>');
    b.set(
      'skills/x/img.png',
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, ...Buffer.from(' AKIAIOSFODNN7EXAMPLE ')]),
    );
    const paths = scanForSecrets(b).map((f) => f.path);
    expect(paths).toContain('avatar.svg');
    expect(paths).toContain('skills/x/img.png');
  });

  it('applies the publicKey allowlist only to signature.json and the manifest author pubkey', () => {
    const b = Bundle.empty();
    b.set('mcp/servers.json', JSON.stringify({ env: { publicKey: hex(32) } }));
    b.set('uniqent.json', JSON.stringify({ author: { name: 'x', pubkey: hex(32) } }));
    b.set(
      'signature.json',
      JSON.stringify({ publicKey: hex(32), signature: hex(64), digest: hex(32) }),
    );
    expect(scanForSecrets(b).map((f) => f.path)).toEqual(['mcp/servers.json']);
  });

  it('does not let a credentialRef placeholder hide a secret', () => {
    expect(isLikelySecretValue('${credentialRef:ghp_0123456789abcdefghijklmnopqrstuvwx}')).toBe(
      true,
    );
    expect(isLikelySecretValue('${credentialRef:x} sk-abcdefghijklmnopqrstuvwxyz0123')).toBe(true);
    expect(
      isLikelySecretValue('postgres://app:${credentialRef:db_password}@db.example.com/app'),
    ).toBe(false);
  });

  it.each([
    ['scoped npm package', 'npx -y @modelcontextprotocol/server-github'],
    ['npm package path', 'modelcontextprotocol/server-sequential-thinking'],
    ['sha512 integrity', `sha512-${randomBytes(64).toString('base64')}`],
    ['sha384 SRI', `integrity="sha384-${randomBytes(48).toString('base64')}"`],
    ['image digest', `ghcr.io/org/img@sha256:${hex(32)}`],
    [
      'google drive link',
      `https://drive.google.com/file/d/1${randomBytes(24).toString('base64url')}/view`,
    ],
    ['env-ref password', 'postgres://app:$DB_PASSWORD@db.example.com/app'],
    [
      'svg data uri',
      `<image href="data:image/png;base64,${randomBytes(300).toString('base64')}"/>`,
    ],
    ['unnamed git sha', `commit ${hex(20)}`],
  ])('does not flag %s', (_label, value) => {
    expect(isLikelySecretValue(value)).toBe(false);
  });
});
