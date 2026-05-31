import type { Components, PermissionScope, McpServer, Channel, RuntimeConfig } from '@uniqent/spec';

export interface ComponentsInput {
  hasPersona: boolean;
  facts: number;
  episodic: number;
  hasProfile: boolean;
  skills: string[];
  mcp: string[];
  tools: string[];
  tasks: string[];
  channels: string[];
}

const sorted = (xs: string[]): string[] => [...xs].sort();

/** Derive the manifest `components` block from current brain contents. */
export function deriveComponents(input: ComponentsInput): Components {
  return {
    identity: input.hasPersona,
    memory: { facts: input.facts, episodic: input.episodic, hasProfile: input.hasProfile },
    skills: sorted(input.skills),
    mcp: sorted(input.mcp),
    tools: sorted(input.tools),
    tasks: sorted(input.tasks),
    channels: sorted(input.channels),
  };
}

/**
 * Derive a baseline permission scope. Network endpoints come from MCP http URLs;
 * stdio servers imply process spawning. Any field present in `override` wins, so a
 * round-trip through fromBundle preserves stored permissions exactly. Filesystem is
 * never inferred.
 */
export function derivePermissions(
  mcp: McpServer[],
  _channels: Channel[],
  runtime: RuntimeConfig | undefined,
  override: Partial<PermissionScope> | undefined,
): PermissionScope {
  const endpoints = new Set<string>();
  for (const s of mcp) {
    if (s.url) {
      try {
        endpoints.add(new URL(s.url).host);
      } catch {
        // ignore unparseable URLs
      }
    }
  }
  const spawnsProcesses = mcp.some((s) => s.transport === 'stdio');

  const result: PermissionScope = {
    filesystem: override?.filesystem ?? { read: [], write: [] },
    network: override?.network ?? { endpoints: [...endpoints].sort() },
    autonomy: override?.autonomy ?? runtime?.autonomy ?? 'suggest',
    spawnsProcesses: override?.spawnsProcesses ?? spawnsProcesses,
  };
  if (override?.notes !== undefined) result.notes = override.notes;
  return result;
}
