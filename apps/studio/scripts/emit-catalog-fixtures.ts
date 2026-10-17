/**
 * Emits the catalog fixtures Rust embeds with `include_str!` (fixtures/catalog.json is the
 * palette's view, fixtures/catalog-data.json the full builder catalogs), both derived from
 * `@uniqent/builder`. Run via `pnpm --filter @uniqent/studio fixtures`.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MCP_CATALOG, SKILL_CATALOG, CHANNEL_CATALOG } from '@uniqent/builder';
import type { CatalogView } from '../web/src/types.js';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** What the palette lists: each catalog entry's display fields plus the install targets. */
export function catalogView(): CatalogView {
  return {
    mcp: MCP_CATALOG.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      transport: e.server.transport,
      credential: e.credential?.ref,
    })),
    skills: SKILL_CATALOG.map((e) => ({ name: e.name, description: e.description })),
    channels: CHANNEL_CATALOG.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      kind: e.channel.kind,
      credential: e.credential?.ref,
    })),
    // Must match `TargetId` in packages/builder/src/detect-markers.ts (one adapter per target).
    targets: ['claude-code', 'hermes', 'openclaw'],
  };
}

/** The full builder catalogs Rust adds components from. */
export function catalogData(): {
  mcp: typeof MCP_CATALOG;
  skills: typeof SKILL_CATALOG;
  channels: typeof CHANNEL_CATALOG;
} {
  return { mcp: MCP_CATALOG, skills: SKILL_CATALOG, channels: CHANNEL_CATALOG };
}

const write = (name: string, data: unknown) =>
  writeFile(join(out, name), JSON.stringify(data, null, 2) + '\n');

// Only run when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await write('catalog.json', catalogView());
  await write('catalog-data.json', catalogData());
  console.log('catalog fixtures written to', out);
}
