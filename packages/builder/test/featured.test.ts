import { describe, it, expect } from 'vitest';
import { featuredBrains, findFeatured } from '../src/featured.js';

describe('featuredBrains', () => {
  it('includes research-analyst with a pitch and a suggested prompt', () => {
    const ra = featuredBrains().find((b) => b.name === 'research-analyst');
    expect(ra).toBeDefined();
    expect(ra!.pitch.length).toBeGreaterThan(10);
    expect(ra!.suggestedPrompts.length).toBeGreaterThan(0);
  });

  it('findFeatured returns undefined for unknown names', () => {
    expect(findFeatured('nope')).toBeUndefined();
    expect(findFeatured('research-analyst')?.displayName).toBe('Research Analyst');
  });
});
