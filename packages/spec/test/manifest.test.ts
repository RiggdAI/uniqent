import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Manifest, McpServer, CredentialRequirement, MemoryItem } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(here, '../../../examples/dev-powerpack/uniqent.json');

describe('Manifest', () => {
  it('validates the dev-powerpack example manifest', () => {
    const raw = JSON.parse(readFileSync(examplePath, 'utf8'));
    const result = Manifest.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it('rejects a non-slug name', () => {
    const raw = JSON.parse(readFileSync(examplePath, 'utf8'));
    raw.name = 'Not A Slug';
    expect(Manifest.safeParse(raw).success).toBe(false);
  });

  it('rejects a non-semver version', () => {
    const raw = JSON.parse(readFileSync(examplePath, 'utf8'));
    raw.version = 'v1';
    expect(Manifest.safeParse(raw).success).toBe(false);
  });

  it('rejects an unknown specVersion', () => {
    const raw = JSON.parse(readFileSync(examplePath, 'utf8'));
    raw.specVersion = '0.2';
    expect(Manifest.safeParse(raw).success).toBe(false);
  });

  it('rejects a missing required field', () => {
    const raw = JSON.parse(readFileSync(examplePath, 'utf8'));
    delete raw.permissions;
    expect(Manifest.safeParse(raw).success).toBe(false);
  });
});

describe('CredentialRequirement', () => {
  const base = {
    ref: 'github_pat',
    label: 'GitHub PAT',
    type: 'apiKey',
    consumedBy: ['mcp:github'],
    required: true,
  };

  it('accepts a minimal apiKey requirement', () => {
    expect(CredentialRequirement.safeParse(base).success).toBe(true);
  });

  it('rejects oauth details on a non-oauth2 type', () => {
    const bad = { ...base, oauth: { scopes: ['repo'] } };
    expect(CredentialRequirement.safeParse(bad).success).toBe(false);
  });

  it('accepts oauth details when type is oauth2', () => {
    const ok = { ...base, type: 'oauth2', oauth: { scopes: ['repo'] } };
    expect(CredentialRequirement.safeParse(ok).success).toBe(true);
  });
});

describe('McpServer', () => {
  it('requires a url for http transports', () => {
    const bad = {
      id: 'github',
      transport: 'streamable-http',
      auth: { type: 'bearer', credentialRef: 'github_pat' },
      tools: { include: 'all' },
    };
    expect(McpServer.safeParse(bad).success).toBe(false);
  });

  it('requires a command for stdio transport', () => {
    const bad = {
      id: 'filesystem',
      transport: 'stdio',
      auth: { type: 'none' },
      tools: { include: 'all' },
    };
    expect(McpServer.safeParse(bad).success).toBe(false);
  });

  it('accepts a valid stdio server', () => {
    const ok = {
      id: 'filesystem',
      transport: 'stdio',
      command: 'mcp-server-filesystem',
      args: ['--root', '~/code'],
      auth: { type: 'none' },
      tools: { include: 'all' },
    };
    expect(McpServer.safeParse(ok).success).toBe(true);
  });

  it('requires headerName when auth type is header', () => {
    const bad = {
      id: 'svc',
      transport: 'streamable-http',
      url: 'https://example.com/mcp',
      auth: { type: 'header', credentialRef: 'svc_key' },
      tools: { include: 'all' },
    };
    expect(McpServer.safeParse(bad).success).toBe(false);
  });
});

describe('MemoryItem', () => {
  it('validates a fact with importance', () => {
    const ok = {
      id: 'm1',
      kind: 'fact',
      text: 'The user prefers TypeScript.',
      createdAt: '2026-05-31T00:00:00.000Z',
      importance: 0.8,
    };
    expect(MemoryItem.safeParse(ok).success).toBe(true);
  });

  it('rejects importance out of range', () => {
    const bad = {
      id: 'm2',
      kind: 'fact',
      text: 'x',
      createdAt: '2026-05-31T00:00:00.000Z',
      importance: 1.5,
    };
    expect(MemoryItem.safeParse(bad).success).toBe(false);
  });

  it('defaults visibility to shareable when omitted', () => {
    const r = MemoryItem.safeParse({
      id: 'm3',
      kind: 'fact',
      text: 'x',
      createdAt: '2026-05-31T00:00:00.000Z',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.visibility).toBe('shareable');
  });

  it('accepts visibility "personal"', () => {
    const r = MemoryItem.safeParse({
      id: 'm4',
      kind: 'episodic',
      text: 'x',
      createdAt: '2026-05-31T00:00:00.000Z',
      visibility: 'personal',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid visibility', () => {
    const r = MemoryItem.safeParse({
      id: 'm5',
      kind: 'fact',
      text: 'x',
      createdAt: '2026-05-31T00:00:00.000Z',
      visibility: 'secret',
    });
    expect(r.success).toBe(false);
  });
});
