import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildJsonSchema } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../schema/uniqent.schema.json');

describe('generated JSON Schema', () => {
  it('has been generated (run `pnpm --filter @uniqent/spec gen`)', () => {
    expect(existsSync(schemaPath)).toBe(true);
  });

  it('matches the current zod schema (no drift)', () => {
    const committed = readFileSync(schemaPath, 'utf8');
    const fresh = JSON.stringify(buildJsonSchema(), null, 2) + '\n';
    expect(committed).toBe(fresh);
  });

  it('exposes Manifest and all components under definitions', () => {
    const schema = buildJsonSchema() as { definitions?: Record<string, unknown> };
    expect(schema.definitions?.Manifest).toBeDefined();
    expect(schema.definitions?.CredentialRequirement).toBeDefined();
    expect(schema.definitions?.PermissionScope).toBeDefined();
  });
});
