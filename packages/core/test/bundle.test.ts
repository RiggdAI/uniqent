import { describe, it, expect } from 'vitest';
import { Bundle, PATHS } from '../src/bundle';
import { BundleFormatError } from '../src/errors';
import { makeValidBundle } from './helpers';

describe('Bundle', () => {
  it('stores and reads raw files as bytes and text', () => {
    const b = Bundle.empty();
    b.set('a.txt', 'hello');
    expect(b.has('a.txt')).toBe(true);
    expect(b.getText('a.txt')).toBe('hello');
    expect(b.get('a.txt')).toBeInstanceOf(Uint8Array);
  });

  it('lists paths sorted and supports delete', () => {
    const b = Bundle.empty();
    b.set('b.txt', '1');
    b.set('a.txt', '2');
    expect(b.list()).toEqual(['a.txt', 'b.txt']);
    expect(b.delete('a.txt')).toBe(true);
    expect(b.list()).toEqual(['b.txt']);
  });

  it('parses the manifest via a typed accessor', () => {
    const b = makeValidBundle();
    expect(b.manifest().name).toBe('test-brain');
  });

  it('throws BundleFormatError when manifest is missing', () => {
    expect(() => Bundle.empty().manifest()).toThrow(BundleFormatError);
  });

  it('reads memory facts and skill names', () => {
    const b = makeValidBundle();
    expect(b.memoryFacts()).toHaveLength(1);
    expect(b.memoryFacts()[0].kind).toBe('fact');
    expect(b.skillNames()).toEqual(['code-review']);
  });

  it('reads MCP servers and returns [] for absent components', () => {
    const b = makeValidBundle();
    expect(b.mcpServers()[0].id).toBe('github');
    expect(b.channels()).toEqual([]);
    expect(b.runtime()).toBeUndefined();
    expect(b.signature()).toBeUndefined();
  });

  it('exposes PATHS constants', () => {
    expect(PATHS.manifest).toBe('uniqent.json');
    expect(PATHS.signature).toBe('signature.json');
  });
});
