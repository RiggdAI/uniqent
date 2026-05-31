import { describe, it, expect } from 'vitest';
import { MCP_CATALOG, SKILL_CATALOG } from '../src/catalog/index';
import { McpServer } from '@uniqent/spec';

describe('catalogs', () => {
  it('every MCP catalog server is schema-valid', () => {
    for (const e of MCP_CATALOG) expect(McpServer.safeParse(e.server).success).toBe(true);
  });

  it('github entry carries a credential requirement', () => {
    const gh = MCP_CATALOG.find((e) => e.id === 'github');
    expect(gh?.credential?.ref).toBe('github_pat');
  });

  it('filesystem is a stdio server', () => {
    const fs = MCP_CATALOG.find((e) => e.id === 'filesystem');
    expect(fs?.server.transport).toBe('stdio');
  });

  it('skill catalog has code-review and summarize', () => {
    expect(SKILL_CATALOG.map((s) => s.name).sort()).toEqual(['code-review', 'summarize']);
  });
});
