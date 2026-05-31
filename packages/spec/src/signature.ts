import { z } from 'zod';

/** Detached signature over a canonical digest of bundle contents — signature.json. */
export const Signature = z.object({
  algorithm: z.literal('ed25519'),
  /** Hex- or base64-encoded Ed25519 public key. */
  publicKey: z.string().min(1),
  /** Algorithm used to compute the canonical digest, e.g. "sha256". */
  digestAlgorithm: z.literal('sha256'),
  /** The canonical digest of bundle contents that was signed. */
  digest: z.string().min(1),
  /** The detached signature over `digest`. */
  signature: z.string().min(1),
  signedAt: z.string().datetime(),
});
export type Signature = z.infer<typeof Signature>;
