import { z } from 'zod';
import { Autonomy } from './common.js';

/** Model/provider preferences, defaults, autonomy and tool allowlist — setup/runtime.json. */
export const RuntimeConfig = z.object({
  model: z
    .object({
      provider: z.string().optional(),
      name: z.string().optional(),
    })
    .optional(),
  autonomy: Autonomy.optional(),
  /** Tool ids the agent is allowed to use. */
  toolAllowlist: z.array(z.string()).optional(),
  /** Non-secret default settings. */
  defaults: z.record(z.string(), z.unknown()).optional(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;
