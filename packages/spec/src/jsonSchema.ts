import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';
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
export const SCHEMA_REGISTRY: Record<string, ZodTypeAny> = {
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

/**
 * Builds the canonical single-document JSON Schema (draft-07): Manifest at the root,
 * every named schema available under `definitions`. Deterministic — used by both the
 * generator and the drift test.
 */
export function buildJsonSchema(): Record<string, unknown> {
  const jsonSchema = zodToJsonSchema(Manifest, {
    $refStrategy: 'root',
    definitions: SCHEMA_REGISTRY,
  }) as Record<string, unknown>;
  jsonSchema.$schema = 'http://json-schema.org/draft-07/schema#';
  jsonSchema.$id = 'https://uniqent.dev/schema/uniqent.schema.json';
  jsonSchema.title = `Uniqent bundle manifest (specVersion ${SPEC_VERSION})`;
  return jsonSchema;
}
