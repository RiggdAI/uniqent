import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogData, catalogView } from '../scripts/emit-catalog-fixtures.js';

const fx = (n: string) =>
  JSON.parse(readFileSync(join(__dirname, '..', 'fixtures', n), 'utf8')) as unknown;

describe('catalog fixtures (embedded by Rust) stay in sync with the builder catalogs', () => {
  it('catalog.json matches the catalog view', () => {
    expect(JSON.parse(JSON.stringify(catalogView()))).toEqual(fx('catalog.json'));
  });
  it('catalog-data.json matches the builder catalogs', () => {
    expect(catalogData()).toEqual(fx('catalog-data.json'));
  });
});
