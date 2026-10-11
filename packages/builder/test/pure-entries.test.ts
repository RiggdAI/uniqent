import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ENTRIES = [
  resolve(root, 'core/dist/pure.js'),
  resolve(root, 'builder/dist/hubs-entry.js'),
  resolve(root, 'builder/dist/memory-entry.js'),
  resolve(root, 'builder/dist/brain-entry.js'),
  resolve(root, 'adapter-sdk/dist/pure.js'),
  resolve(root, 'adapter-hermes/dist/pure.js'),
  resolve(root, 'adapter-claude-code/dist/pure.js'),
];
const RESOLVE: Record<string, string> = {
  '@uniqent/core/pure': resolve(root, 'core/dist/pure.js'),
  '@uniqent/spec': resolve(root, 'spec/dist/index.js'),
  '@uniqent/builder/memory': resolve(root, 'builder/dist/memory-entry.js'),
  '@uniqent/builder/brain': resolve(root, 'builder/dist/brain-entry.js'),
  '@uniqent/adapter-sdk/pure': resolve(root, 'adapter-sdk/dist/pure.js'),
};

/** Every problem (node: import, Buffer, process, non-pure workspace import) reachable from `entry`. */
function problems(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    if (/\bBuffer\./.test(src)) found.push(`${file}: uses Buffer`);
    if (/\bprocess\./.test(src)) found.push(`${file}: uses process`);
    for (const m of src.matchAll(/(?:import|export)[^'"]*from\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1] as string;
      if (spec.startsWith('node:')) found.push(`${file}: imports ${spec}`);
      else if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else if (spec.startsWith('@uniqent/')) {
        const target = RESOLVE[spec];
        if (!target) found.push(`${file}: imports ${spec} (not a pure entry)`);
        else visit(target);
      }
    }
  };
  visit(entry);
  return found;
}

describe('browser-safe entry points', () => {
  for (const entry of ENTRIES) {
    it(`${entry.split('/packages/')[1]} has no Node-only code in its module graph`, () => {
      expect(existsSync(entry), `build first: ${entry}`).toBe(true);
      expect(problems(entry)).toEqual([]);
    });
  }
});
