import { describe, expect, it, vi } from 'vitest';
import { fetchMemoryPack, publishMemoryPack, searchMemoryHub } from '../src/hubs/memory-hub.js';

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

describe('memory hub search and pull', () => {
  // The registry's search (`GET /api/v1/memory?q=`) and pack (`GET /api/v1/memory/:slug`) replies.
  const hub = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (/\/api\/v1\/memory\/[^?]/.test(url)) {
      return new Response(
        JSON.stringify({
          facts: [
            { kind: 'decision', text: 'use [[Postgres]] #db' },
            { kind: 'fact', text: 'tune it for OLTP' },
          ],
        }),
      );
    }
    return new Response(
      JSON.stringify({
        packs: [
          {
            slug: 'platform',
            name: 'Platform',
            description: 'd',
            tags: ['db'],
            factCount: 2,
            url: 'https://x/p.json',
          },
        ],
      }),
    );
  });

  it('searches packs and pulls one with its kinds preserved', async () => {
    const r = await searchMemoryHub(hub, 'db', 'https://reg/', undefined);
    expect(String(hub.mock.calls[0]?.[0])).toBe('https://reg/api/v1/memory?q=db');
    expect(r.errors).toEqual([]);
    expect(r.results).toEqual([
      {
        source: 'memory-hub',
        slug: 'platform',
        name: 'Platform',
        description: 'd',
        tags: ['db'],
        factCount: 2,
        url: 'https://x/p.json',
      },
    ]);
    const facts = await fetchMemoryPack(hub, 'https://reg', 'platform', undefined);
    expect(String(hub.mock.calls[1]?.[0])).toBe('https://reg/api/v1/memory/platform');
    expect(facts).toEqual([
      { kind: 'decision', text: 'use [[Postgres]] #db' },
      { kind: 'fact', text: 'tune it for OLTP' },
    ]);
  });
});
