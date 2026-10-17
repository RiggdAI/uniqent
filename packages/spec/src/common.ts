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

/**
 * A UTC timestamp as spec 0.1 accepts it: calendar-valid date, `T`, HH:MM with optional
 * seconds and fraction, `Z` (e.g. `2026-01-01T09:30Z`, `2026-01-01T09:30:05.123Z`). Zod 4's
 * `datetime()` requires seconds, which would reject bundles that 0.1 already accepted.
 */
export const IsoUtcDateTime = z
  .string()
  .regex(
    /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|02-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?Z$/,
    'must be a UTC ISO 8601 datetime (e.g. 2026-01-01T09:30:00Z)',
  );

/** Autonomy level: how freely an agent may act. */
export const Autonomy = z.enum(['manual', 'suggest', 'auto']);
export type Autonomy = z.infer<typeof Autonomy>;
