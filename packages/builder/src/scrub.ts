import type { Bundle } from '@uniqent/core/pure';
import { Brain } from './brain.js';

/** How many memory items `scrubPrivateMemory` dropped, by reason (an episodic item counts once, as episodic). */
export interface ScrubReport {
  episodic: number;
  personal: number;
}

/**
 * Drop episodic and `visibility: "personal"` memory — capture never carries a colleague's private
 * notes. Returns the input bundle itself (same bytes) when there is nothing to remove.
 */
export function scrubPrivateMemory(bundle: Bundle): { bundle: Bundle; removed: ScrubReport } {
  const items = [...bundle.memoryFacts(), ...bundle.memoryEpisodic()];
  const episodic = items.filter((m) => m.kind === 'episodic');
  const personal = items.filter((m) => m.kind !== 'episodic' && m.visibility === 'personal');
  const removed = { episodic: episodic.length, personal: personal.length };
  if (episodic.length + personal.length === 0) return { bundle, removed };
  const brain = Brain.fromBundle(bundle);
  for (const m of [...episodic, ...personal]) brain.removeMemory(m.id);
  return { bundle: brain.toBundle(), removed };
}
