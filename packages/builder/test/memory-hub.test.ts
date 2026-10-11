import { describe, expect, it, vi } from 'vitest';
import { publishMemoryPack } from '../src/hubs/memory-hub.js';

describe('publishMemoryPack', () => {
  it('refuses to upload a pack whose facts contain a likely secret, naming the facts only', async () => {
    const secret = `ghp_${'a1B2c3D4e5'.repeat(4)}`;
    const fetchFn = vi.fn(async () => new Response('{}'));
    const pack = {
      slug: 'ops',
      name: 'Ops',
      facts: [
        { kind: 'fact', text: 'Team uses Postgres' },
        { kind: 'fact', text: `deploy key: ${secret}` },
      ],
    };
    const err = await publishMemoryPack(fetchFn, 'https://reg', 'tok', pack, undefined).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/fact #2/);
    expect((err as Error).message).not.toContain(secret);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
