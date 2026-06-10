import { describe, it, expect } from 'vitest';
import { StudioSession } from '../src/server/session.js';

const BLOB = JSON.stringify({
  mcpServers: {
    brave: {
      command: 'npx',
      args: ['-y', 'brave'],
      env: { BRAVE_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz0123' },
    },
  },
});

describe('paste MCP', () => {
  it('previewPastedMcp returns servers + lifted credentials, mutates nothing', () => {
    const s = new StudioSession();
    const preview = s.previewPastedMcp(BLOB);
    expect(preview.servers[0]!.id).toBe('brave');
    expect(preview.credentials[0]!.consumedBy).toContain('mcp:brave');
    expect(s.state().manifest.components.mcp).not.toContain('brave'); // no mutation
  });

  it('addPastedMcp adds the server + credential to the brain', () => {
    const s = new StudioSession();
    s.addPastedMcp(BLOB);
    expect(s.state().manifest.components.mcp).toContain('brave');
    expect(s.state().manifest.credentials.some((c) => c.ref === 'brave_brave_api_key')).toBe(true);
  });

  it('previewPastedMcp reports bad JSON without throwing', () => {
    const s = new StudioSession();
    const preview = s.previewPastedMcp('not json {');
    expect(preview.servers).toEqual([]);
    expect(preview.lossiness.length).toBeGreaterThan(0);
  });
});
