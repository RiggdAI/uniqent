import { describe, it, expect } from 'vitest';
import { loadFeaturedBundle } from '../src/featured.js';

describe('loadFeaturedBundle', () => {
  it('loads research-analyst as an unpackable bundle', async () => {
    const bundle = await loadFeaturedBundle('research-analyst');
    const manifest = bundle.get('uniqent.json');
    expect(manifest).toBeDefined();
    const m = JSON.parse(new TextDecoder().decode(manifest!));
    expect(m.name).toBe('research-analyst');
  });
});
