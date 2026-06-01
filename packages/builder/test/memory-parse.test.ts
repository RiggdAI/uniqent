import { describe, it, expect } from 'vitest';
import {
  parseMemoryText,
  parseMemoryMarkdown,
  memoryGraph,
  stripMemoryMarkup,
} from '../src/index.js';

describe('parseMemoryText', () => {
  it('extracts wikilink entities and #tags, deduped', () => {
    const p = parseMemoryText('[[Acme]] chose [[Postgres]] over [[Acme]] preferences #db #infra');
    expect(p.entities).toEqual(['Acme', 'Postgres']);
    expect(p.tags).toEqual(['db', 'infra']);
  });

  it('does not treat a markdown heading "# " as a tag', () => {
    expect(parseMemoryText('# Heading not a tag').tags).toEqual([]);
  });
});

describe('parseMemoryMarkdown', () => {
  it('splits lines/bullets, skips headings, classifies by EXPLICIT prefix only, keeps links', () => {
    const items = parseMemoryMarkdown(
      [
        '# Context',
        '- Decision: we will use [[Postgres]] #db',
        '* [!preference] the user likes [[TypeScript]]',
        'The API hit a rate limit yesterday', // no prefix → fact (NOT a milestone)
        '   ',
      ].join('\n'),
    );
    expect(items.map((i) => i.kind)).toEqual(['decision', 'preference', 'fact']);
    expect(items[0]?.text).toBe('we will use [[Postgres]] #db'); // "Decision:" stripped
    expect(items[1]?.text).toBe('the user likes [[TypeScript]]'); // "[!preference]" stripped
    expect(items[0]?.entities).toEqual(['Postgres']);
  });
});

describe('stripMemoryMarkup', () => {
  it('renders [[entities]]/[[a|alias]] to names and removes #tags, for installed output', () => {
    expect(stripMemoryMarkup('standardized on [[Postgres]] over [[MongoDB]] #db #infra')).toBe(
      'standardized on Postgres over MongoDB',
    );
    expect(stripMemoryMarkup('see [[Auth-Service|the auth service]] for #security')).toBe(
      'see the auth service for',
    );
    expect(stripMemoryMarkup('no markup here')).toBe('no markup here');
  });
});

describe('memoryGraph', () => {
  it('builds memory/entity/tag nodes with shared entities clustering items', () => {
    const g = memoryGraph([
      { id: 'a', text: 'chose [[Postgres]] #db', kind: 'decision' },
      { id: 'b', text: '[[Postgres]] tuning notes #db #perf', kind: 'fact' },
    ]);
    const ids = g.nodes.map((n) => n.id).sort();
    expect(ids).toContain('mem:a');
    expect(ids).toContain('mem:b');
    expect(ids).toContain('ent:postgres');
    expect(ids).toContain('tag:db');
    // The shared Postgres entity connects both memory items (degree 2).
    const pg = g.nodes.find((n) => n.id === 'ent:postgres');
    expect(pg?.degree).toBe(2);
    expect(pg?.type).toBe('entity');
    // No duplicate edges.
    expect(g.edges.length).toBe(new Set(g.edges.map((e) => `${e.source} ${e.target}`)).size);
  });

  it('returns an empty graph for memory with no links/tags', () => {
    const g = memoryGraph([{ text: 'a plain fact with no structure' }]);
    expect(g.nodes).toHaveLength(1);
    expect(g.edges).toHaveLength(0);
    expect(g.nodes[0]?.type).toBe('memory');
  });
});
