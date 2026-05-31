import { z } from 'zod';

export const MemoryKind = z.enum(['fact', 'decision', 'preference', 'milestone', 'episodic']);
export type MemoryKind = z.infer<typeof MemoryKind>;

/** One line in facts.jsonl / episodic.jsonl. */
export const MemoryItem = z.object({
  id: z.string().min(1),
  kind: MemoryKind,
  text: z.string(),
  /** Provenance: where this came from. */
  source: z.string().optional(),
  createdAt: z.string().datetime(),
  /** 0..1; used when a target must prioritize/truncate under memory limits. */
  importance: z.number().min(0).max(1).optional(),
  /** Privacy tier; export scrubs "personal" (and episodic) by default. */
  visibility: z.enum(['shareable', 'personal']).default('shareable'),
  tags: z.array(z.string()).optional(),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

/** Structured "who the user/agent is" — memory/profile.json. Free-form key/value. */
export const MemoryProfile = z.record(z.string(), z.unknown());
export type MemoryProfile = z.infer<typeof MemoryProfile>;
