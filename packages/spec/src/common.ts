import { z } from 'zod';

/** The bundle format version. Tools must refuse versions they do not understand. */
export const SpecVersion = z.literal('0.1');
export type SpecVersion = z.infer<typeof SpecVersion>;

/** The current spec version emitted by this toolchain. */
export const SPEC_VERSION = '0.1' as const;

/** Slug-safe identifier: lowercase letters, digits, hyphens; must start alphanumeric. */
export const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be slug-safe (lowercase letters, digits, hyphens)');

/** Semantic version string (semver 2.0.0). */
export const Semver = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    'must be a valid semver (e.g. 1.2.3)',
  );

/** Autonomy level: how freely an agent may act. */
export const Autonomy = z.enum(['manual', 'suggest', 'auto']);
export type Autonomy = z.infer<typeof Autonomy>;
