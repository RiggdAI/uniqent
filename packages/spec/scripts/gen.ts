/**
 * Generates schema/uniqent.schema.json and docs/SPEC.md from the zod schema.
 * Run via `pnpm --filter @uniqent/spec gen`. Never hand-edit the generated artifacts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildJsonSchema, SCHEMA_REGISTRY, SPEC_VERSION } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../schema/uniqent.schema.json');
const specPath = resolve(here, '../../../docs/SPEC.md');

/** Per-schema docs: which bundle file it governs and a one-line summary. */
const DOCS: Record<string, { file: string; summary: string }> = {
  Manifest: { file: 'uniqent.json', summary: 'The bundle manifest.' },
  CredentialRequirement: {
    file: 'uniqent.json (credentials[])',
    summary: 'The install contract: what a bundle needs and what consumes it. Never a value.',
  },
  PermissionScope: {
    file: 'uniqent.json (permissions)',
    summary: 'The permission sheet shown before any write.',
  },
  McpServersFile: {
    file: 'mcp/servers.json',
    summary: 'MCP server declarations (transport, auth type, tool allowlist, credentialRef).',
  },
  MemoryItem: {
    file: 'memory/facts.jsonl, memory/episodic.jsonl',
    summary: 'One memory line (fact/decision/preference/milestone/episodic).',
  },
  MemoryProfile: { file: 'memory/profile.json', summary: 'Structured "who the user/agent is".' },
  ChannelsFile: {
    file: 'channels/channels.json',
    summary: 'Messaging surfaces with credentialRefs.',
  },
  ToolsFile: { file: 'tools/tools.json', summary: 'Native/built-in tool enablement.' },
  Task: { file: 'tasks/*.json', summary: 'An automation: trigger + action.' },
  RuntimeConfig: {
    file: 'setup/runtime.json',
    summary: 'Model/provider prefs, defaults, autonomy, tool allowlist.',
  },
  Signature: {
    file: 'signature.json',
    summary: 'Detached Ed25519 signature over a canonical digest.',
  },
};

// --- JSON Schema ---
mkdirSync(dirname(schemaPath), { recursive: true });
writeFileSync(schemaPath, JSON.stringify(buildJsonSchema(), null, 2) + '\n');

// --- SPEC.md ---
const lines: string[] = [];
lines.push(
  '<!-- GENERATED FILE — edit packages/spec then run `pnpm --filter @uniqent/spec gen`. -->',
);
lines.push('');
lines.push('# The `.uniqent` bundle format');
lines.push('');
lines.push(
  `Spec version: **${SPEC_VERSION}**. Dedicated to the public domain under CC0 (see \`LICENSE-SPEC\`).`,
);
lines.push('');
lines.push(
  'A `.uniqent` file is a gzipped tar of a bundle directory. The schemas below are generated from',
);
lines.push(
  'the zod definitions in `packages/spec` — the source of truth. The machine-readable JSON Schema is',
);
lines.push(
  'at [`packages/spec/schema/uniqent.schema.json`](../packages/spec/schema/uniqent.schema.json).',
);
lines.push('');
lines.push('## Bundle layout');
lines.push('');
lines.push('```');
lines.push('<bundle>/');
lines.push('├── uniqent.json             # manifest (REQUIRED)');
lines.push('├── signature.json           # detached Ed25519 signature (added by `sign`)');
lines.push('├── identity/                # persona.md (+ optional policies.md)');
lines.push('├── memory/                  # profile.json, facts.jsonl, episodic.jsonl');
lines.push('├── skills/<name>/SKILL.md   # cross-agent skills');
lines.push('├── mcp/servers.json         # MCP server declarations');
lines.push('├── tools/tools.json         # native tool enablement');
lines.push('├── tasks/*.json             # automations');
lines.push('├── channels/channels.json   # messaging surfaces');
lines.push('└── setup/runtime.json       # model/provider prefs, defaults');
lines.push('```');
lines.push('');
lines.push('## Schemas');
lines.push('');
for (const name of Object.keys(SCHEMA_REGISTRY)) {
  const d = DOCS[name];
  lines.push(`- [\`${name}\`](#${name.toLowerCase()}) — ${d.file} — ${d.summary}`);
}
lines.push('');
for (const [name, schema] of Object.entries(SCHEMA_REGISTRY)) {
  const d = DOCS[name];
  const single = zodToJsonSchema(schema, { $refStrategy: 'none' });
  lines.push(`### ${name}`);
  lines.push('');
  lines.push(`*File:* \`${d.file}\``);
  lines.push('');
  lines.push(d.summary);
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(single, null, 2));
  lines.push('```');
  lines.push('');
}

mkdirSync(dirname(specPath), { recursive: true });
writeFileSync(specPath, lines.join('\n'));

console.log(`Wrote ${schemaPath}`);
console.log(`Wrote ${specPath}`);
