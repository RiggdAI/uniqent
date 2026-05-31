import { z } from 'zod';

export const McpTransport = z.enum(['streamable-http', 'sse', 'stdio']);
export type McpTransport = z.infer<typeof McpTransport>;

export const McpAuthType = z.enum(['none', 'bearer', 'header', 'oauth2']);

export const McpAuth = z.object({
  type: McpAuthType,
  /** Resolved locally at install; never a secret value. */
  credentialRef: z.string().optional(),
  /** Required when type is "header". */
  headerName: z.string().optional(),
});

/**
 * An MCP server declaration. env values may only contain literal non-secret strings or
 * "${credentialRef:...}" placeholders — never a secret value.
 */
export const McpServer = z
  .object({
    id: z.string().min(1),
    transport: McpTransport,
    url: z.string().url().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    auth: McpAuth,
    tools: z.object({
      /** Allowlist: "all" or an explicit list of tool names. */
      include: z.union([z.literal('all'), z.array(z.string())]),
    }),
    description: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const isHttp = val.transport === 'streamable-http' || val.transport === 'sse';
    if (isHttp && !val.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `transport "${val.transport}" requires a url`,
        path: ['url'],
      });
    }
    if (val.transport === 'stdio' && !val.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'transport "stdio" requires a command',
        path: ['command'],
      });
    }
    if (val.auth.type === 'header' && !val.auth.headerName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'auth type "header" requires headerName',
        path: ['auth', 'headerName'],
      });
    }
  });
export type McpServer = z.infer<typeof McpServer>;

/** Contents of mcp/servers.json. */
export const McpServersFile = z.object({
  servers: z.array(McpServer),
});
export type McpServersFile = z.infer<typeof McpServersFile>;
