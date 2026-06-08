import { z } from 'zod';
import { SpecVersion, Slug, Semver } from './common.js';
import { CredentialRequirement } from './credentials.js';
import { PermissionScope } from './permissions.js';

export const Author = z.object({
  name: z.string().min(1),
  handle: z.string().optional(),
  url: z.string().url().optional(),
  /** Author's Ed25519 public key (hex/base64), for trust pinning. */
  pubkey: z.string().optional(),
});
export type Author = z.infer<typeof Author>;

/** Declared presence + counts, for quick inspection without unpacking everything. */
export const Components = z.object({
  identity: z.boolean(),
  memory: z.object({
    facts: z.number().int().nonnegative(),
    episodic: z.number().int().nonnegative(),
    hasProfile: z.boolean(),
  }),
  skills: z.array(z.string()),
  mcp: z.array(z.string()),
  tools: z.array(z.string()),
  tasks: z.array(z.string()),
  channels: z.array(z.string()),
});
export type Components = z.infer<typeof Components>;

export const Compatibility = z.object({
  /** Targets the author CLAIMS support for, e.g. ["openclaw", "hermes", "claude-code"]. */
  targets: z.array(z.string()),
});

/** uniqent.json — the bundle manifest. */
export const Manifest = z.object({
  specVersion: SpecVersion,
  name: Slug,
  displayName: z.string().min(1),
  version: Semver,
  description: z.string(),
  author: Author,
  /** SPDX id for the bundle's own content. */
  license: z.string().min(1),
  tags: z.array(z.string()),
  components: Components,
  /** The install contract. */
  credentials: z.array(CredentialRequirement),
  permissions: PermissionScope,
  compatibility: Compatibility,
  /** Demo prompts the brain advertises — shown after install ("now ask it this"). */
  suggestedPrompts: z.array(z.string()).optional(),
  signatureRef: z.literal('signature.json').optional(),
});
export type Manifest = z.infer<typeof Manifest>;
