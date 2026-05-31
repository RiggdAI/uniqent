import { z } from 'zod';

/** Native/built-in tool enablement (web search, browser, code exec, …). */
export const ToolDecl = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  /** Non-secret tool configuration. */
  config: z.record(z.string(), z.unknown()).optional(),
  description: z.string().optional(),
});
export type ToolDecl = z.infer<typeof ToolDecl>;

/** Contents of tools/tools.json. */
export const ToolsFile = z.object({
  tools: z.array(ToolDecl),
});
export type ToolsFile = z.infer<typeof ToolsFile>;
