import { z } from 'zod';

/**
 * How a credential is supplied. Bundles declare requirements only — never values.
 * The installer resolves these locally into the target framework's credential store.
 */
export const CredentialType = z.enum(['apiKey', 'bearer', 'header', 'oauth2', 'envVar']);
export type CredentialType = z.infer<typeof CredentialType>;

export const OAuthDetails = z.object({
  authorizationUrl: z.string().url().optional(),
  scopes: z.array(z.string()).optional(),
  note: z.string().optional(),
});

/** The install contract: what a bundle needs, and what consumes it. */
export const CredentialRequirement = z
  .object({
    /** Referenced elsewhere as credentialRef: "<ref>". */
    ref: z.string().min(1),
    /** Human prompt, e.g. "GitHub Personal Access Token". */
    label: z.string().min(1),
    type: CredentialType,
    /** Component ids that consume this, e.g. ["mcp:github", "channel:telegram"]. */
    consumedBy: z.array(z.string()),
    /** Optional creds degrade gracefully (the consuming component is disabled). */
    required: z.boolean(),
    /** Where/how to obtain it (URL or instructions). */
    help: z.string().optional(),
    oauth: OAuthDetails.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.oauth && val.type !== 'oauth2') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'oauth details are only allowed when type is "oauth2"',
        path: ['oauth'],
      });
    }
  });
export type CredentialRequirement = z.infer<typeof CredentialRequirement>;
