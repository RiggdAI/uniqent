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
 * Derive the permission scope from the brain's content: network endpoints from MCP http URLs,
 * process spawning from stdio servers, autonomy from the runtime config. `declared` holds what
 * the author states on top and can only WIDEN the derived scope, never hide it: filesystem and
 * notes (never inferred), extra endpoints (unioned), spawnsProcesses (OR-ed), and an autonomy
 * used only when the runtime config sets none.
 */
export function derivePermissions(
  mcp: McpServer[],
  _channels: Channel[],
  runtime: RuntimeConfig | undefined,
  declared: Partial<PermissionScope> | undefined,
): PermissionScope {
  const endpoints = new Set<string>(declared?.network?.endpoints ?? []);
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
    filesystem: declared?.filesystem ?? { read: [], write: [] },
    network: { endpoints: [...endpoints].sort() },
    autonomy: runtime?.autonomy ?? declared?.autonomy ?? 'suggest',
    spawnsProcesses: spawnsProcesses || (declared?.spawnsProcesses ?? false),
  };
  if (declared?.notes !== undefined) result.notes = declared.notes;
  return result;
}
