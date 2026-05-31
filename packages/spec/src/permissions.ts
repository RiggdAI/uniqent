import { z } from 'zod';
import { Autonomy } from './common.js';

/** The permission sheet shown to the user before any write at install time. */
export const PermissionScope = z.object({
  filesystem: z.object({
    /** Path globs the agent may read. Empty array if none. */
    read: z.array(z.string()),
    /** Path globs the agent may write. Empty array if none. */
    write: z.array(z.string()),
  }),
  network: z.object({
    /** Domains/endpoints the agent or its MCP servers will reach. */
    endpoints: z.array(z.string()),
  }),
  autonomy: Autonomy,
  spawnsProcesses: z.boolean(),
  notes: z.string().optional(),
});
export type PermissionScope = z.infer<typeof PermissionScope>;
