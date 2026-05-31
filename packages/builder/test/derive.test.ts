import { describe, it, expect } from 'vitest';
import { derivePermissions, deriveComponents } from '../src/derive';
import type { McpServer } from '@uniqent/spec';

const httpServer = {
  id: 'gh',
  transport: 'streamable-http',
  url: 'https://api.example.com/mcp',
  auth: { type: 'none' },
  tools: { include: 'all' },
} as McpServer;

const stdioServer = {
  id: 'fs',
  transport: 'stdio',
  command: 'npx',
  auth: { type: 'none' },
  tools: { include: 'all' },
} as McpServer;

describe('derivePermissions', () => {
  it('collects MCP http hosts and flags stdio process spawning', () => {
    const p = derivePermissions([httpServer, stdioServer], [], undefined, undefined);
    expect(p.network.endpoints).toContain('api.example.com');
    expect(p.spawnsProcesses).toBe(true);
    expect(p.autonomy).toBe('suggest');
  });

  it('override wins over derived values', () => {
    const p = derivePermissions(
      [],
      [],
      { autonomy: 'auto' },
      { filesystem: { read: ['~/x'], write: [] }, autonomy: 'manual' },
    );
    expect(p.autonomy).toBe('manual');
    expect(p.filesystem.read).toEqual(['~/x']);
  });
});

describe('deriveComponents', () => {
  it('reflects contents with sorted name lists', () => {
    const c = deriveComponents({
      hasPersona: true,
      facts: 2,
      episodic: 1,
      hasProfile: false,
      skills: ['b', 'a'],
      mcp: ['github'],
      tools: [],
      tasks: [],
      channels: [],
    });
    expect(c.identity).toBe(true);
    expect(c.memory).toEqual({ facts: 2, episodic: 1, hasProfile: false });
    expect(c.skills).toEqual(['a', 'b']);
    expect(c.mcp).toEqual(['github']);
  });
});
