import { describe, expect, it } from 'vitest';
import { validateBundle } from '@uniqent/core';
import type { MemoryItem } from '@uniqent/spec';
import { Brain } from '../src/brain';
import { scrubPrivateMemory } from '../src/scrub';

const meta = {
  name: 'demo',
  displayName: 'Demo',
  version: '0.1.0',
  description: 'demo brain',
  author: { name: 'Me' },
  license: 'CC0-1.0',
  tags: ['demo'],
};
const item = (id: string, kind: 'fact' | 'episodic', visibility: 'shareable' | 'personal') =>
  ({ id, kind, text: id, createdAt: '2026-05-31T00:00:00.000Z', visibility }) as MemoryItem;
const bundleOf = (items: MemoryItem[]) => {
  const brain = Brain.create(meta);
  for (const i of items) brain.addMemory(i);
  return brain.toBundle();
};

describe('scrubPrivateMemory', () => {
  it('drops episodic and personal memory, keeping shareable facts', () => {
    const { bundle, removed } = scrubPrivateMemory(
      bundleOf([
        item('shared', 'fact', 'shareable'),
        item('mine', 'fact', 'personal'),
        item('day1', 'episodic', 'shareable'),
        item('day2', 'episodic', 'personal'),
      ]),
    );
    expect(removed).toEqual({ episodic: 2, personal: 1 });
    expect(bundle.memoryFacts().map((m) => m.id)).toEqual(['shared']);
    expect(bundle.memoryEpisodic()).toEqual([]);
    expect(validateBundle(bundle).ok).toBe(true);
  });

  it('returns the input bundle itself when nothing is private', () => {
    const input = bundleOf([item('a', 'fact', 'shareable'), item('b', 'fact', 'shareable')]);
    const { bundle, removed } = scrubPrivateMemory(input);
    expect(removed).toEqual({ episodic: 0, personal: 0 });
    expect(bundle).toBe(input);
  });
});
