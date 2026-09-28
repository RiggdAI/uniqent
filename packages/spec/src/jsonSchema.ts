import { z } from 'zod';
import { SPEC_VERSION } from './common.js';
import { Manifest } from './manifest.js';
import { CredentialRequirement } from './credentials.js';
import { PermissionScope } from './permissions.js';
import { McpServersFile } from './mcp.js';
import { MemoryItem, MemoryProfile } from './memory.js';
import { ChannelsFile } from './channels.js';
import { ToolsFile } from './tools.js';
import { Task } from './tasks.js';
import { RuntimeConfig } from './setup.js';
import { Signature } from './signature.js';

/** Named top-level schemas, in document order. The single source for codegen + docs. */
export const SCHEMA_REGISTRY: Record<string, z.ZodType> = {
  Manifest,
  CredentialRequirement,
  PermissionScope,
  McpServersFile,
  MemoryItem,
  MemoryProfile,
  ChannelsFile,
  ToolsFile,
  Task,
  RuntimeConfig,
  Signature,
};

/** One named schema as a standalone draft-07 JSON Schema (all refs inlined). */
export function schemaFor(name: string): Record<string, unknown> {
  const schema = SCHEMA_REGISTRY[name];
  if (!schema) {
    throw new Error(`unknown schema "${name}" (known: ${Object.keys(SCHEMA_REGISTRY).join(', ')})`);
  }
  return z.toJSONSchema(schema, {
    target: 'draft-7',
    io: 'input',
    // Keep the published contract: object schemas are closed (records already carry their own
    // additionalProperties schema, so only plain objects are touched).
    override: (ctx) => {
      const js = ctx.jsonSchema;
      if (js.type === 'object' && js.properties && js.additionalProperties === undefined)
        js.additionalProperties = false;
    },
  }) as Record<string, unknown>;
}

/**
 * Builds the canonical single-document JSON Schema (draft-07): Manifest at the root, every named
 * schema under `definitions`. Deterministic — used by both the generator and the drift test.
 */
export function buildJsonSchema(): Record<string, unknown> {
  const definitions = Object.fromEntries(
    Object.keys(SCHEMA_REGISTRY).map((name) => {
      // Definitions live inside one document, so they drop their own $schema.
      const body = { ...schemaFor(name) };
      delete body.$schema;
      return [name, body];
    }),
  );
  return {
    $ref: '#/definitions/Manifest',
    definitions,
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://uniqent.dev/schema/uniqent.schema.json',
    title: `Uniqent bundle manifest (specVersion ${SPEC_VERSION})`,
  };
}
