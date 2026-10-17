import type { Manifest, McpServer } from '@uniqent/spec';
import { Bundle, PATHS } from './bundle.js';
import { scanForSecrets } from './secret-scan.js';
import { BundleFormatError, BundleValidationError } from './errors.js';

export interface Issue {
  path?: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

export function validateBundle(bundle: Bundle): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  // 1. Manifest + component files parse (each accessor throws on malformed content).
  let manifest;
  try {
    manifest = bundle.manifest();
  } catch (e) {
    errors.push({ path: PATHS.manifest, code: 'manifest', message: (e as Error).message });
  }

  const parseChecks: Array<[string, () => unknown]> = [
    ['mcp', () => bundle.mcpServers()],
    ['channels', () => bundle.channels()],
    ['tools', () => bundle.tools()],
    ['tasks', () => bundle.tasks()],
    ['memory', () => bundle.memoryFacts()],
    ['memory', () => bundle.memoryEpisodic()],
    ['memory', () => bundle.memoryProfile()],
  ];
  for (const [code, fn] of parseChecks) {
    try {
      fn();
    } catch (e) {
      errors.push({ code, message: (e as Error).message });
    }
  }

  if (manifest) {
    // 2. Layout.
    if (manifest.components.identity && !bundle.has(PATHS.persona)) {
      errors.push({
        path: PATHS.persona,
        code: 'layout',
        message: 'components.identity is true but identity/persona.md is missing',
      });
    }
    const presentSkills = new Set(bundle.skillNames());
    for (const skill of manifest.components.skills) {
      if (!presentSkills.has(skill)) {
        errors.push({
          path: `skills/${skill}/SKILL.md`,
          code: 'layout',
          message: `declared skill "${skill}" has no skills/${skill}/SKILL.md`,
        });
      }
    }

    // 3. Cross-reference integrity.
    const refs = new Set(manifest.credentials.map((c) => c.ref));
    try {
      for (const s of bundle.mcpServers()) {
        const ref = s.auth.credentialRef;
        if (ref && !refs.has(ref)) {
          errors.push({
            path: PATHS.mcp,
            code: 'credential-ref',
            message: `mcp server "${s.id}" references unknown credentialRef "${ref}"`,
          });
        }
      }
      for (const c of bundle.channels()) {
        if (c.credentialRef && !refs.has(c.credentialRef)) {
          errors.push({
            path: PATHS.channels,
            code: 'credential-ref',
            message: `channel "${c.id}" references unknown credentialRef "${c.credentialRef}"`,
          });
        }
      }
    } catch {
      // parse errors already recorded above
    }

    // 4. Manifest claims (components + permissions) match the actual content.
    try {
      errors.push(...manifestContentIssues(manifest, bundle));
    } catch (e) {
      if (!(e instanceof BundleFormatError)) throw e; // parse errors already recorded above
    }
  }

  // 5. Secret-scan.
  for (const f of scanForSecrets(bundle)) {
    errors.push({
      path: f.path,
      code: 'secret',
      message: `possible ${f.kind} secret (${f.snippet})`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

function missingIssues(
  component: string,
  declared: readonly string[],
  actual: Set<string>,
): Issue[] {
  return declared
    .filter((id) => !actual.has(id))
    .map((id) => ({
      path: PATHS.manifest,
      code: 'manifest-mismatch',
      message: `components.${component} declares "${id}" but the bundle has no such ${component} entry`,
    }));
}

function undeclaredIssues(
  component: string,
  declared: Set<string>,
  actual: readonly string[],
): Issue[] {
  return actual
    .filter((id) => !declared.has(id))
    .map((id) => ({
      path: PATHS.manifest,
      code: 'manifest-mismatch',
      message: `bundle contains ${component} "${id}" but components.${component} does not declare it`,
    }));
}

/** Report ids declared in the manifest but absent from content, and present but undeclared. */
function idListIssues(
  component: string,
  declared: readonly string[],
  actual: readonly string[],
): Issue[] {
  return [
    ...missingIssues(component, declared, new Set(actual)),
    ...undeclaredIssues(component, new Set(declared), actual),
  ];
}

function countIssue(field: string, declared: number | boolean, actual: number | boolean): Issue[] {
  return declared === actual
    ? []
    : [
        {
          path: PATHS.manifest,
          code: 'manifest-mismatch',
          message: `components.${field} is ${declared} but the bundle content has ${actual}`,
        },
      ];
}

/** True when a permissions.network endpoint covers the host (exact host[:port], hostname, or `*.suffix`). */
function endpointCovers(endpoint: string, url: URL): boolean {
  if (endpoint === url.host || endpoint === url.hostname) return true;
  return endpoint.startsWith('*.') && url.hostname.endsWith(endpoint.slice(1));
}

function mcpPermissionIssues(manifest: Manifest, servers: McpServer[]): Issue[] {
  const issues: Issue[] = [];
  for (const s of servers) {
    if (s.transport === 'stdio' && !manifest.permissions.spawnsProcesses) {
      issues.push({
        path: PATHS.manifest,
        code: 'permission-mismatch',
        message: `mcp server "${s.id}" uses stdio (runs "${s.command}") but permissions.spawnsProcesses is false`,
      });
    }
    if ((s.transport === 'streamable-http' || s.transport === 'sse') && s.url) {
      const url = new URL(s.url);
      const endpoints = manifest.permissions.network.endpoints;
      if (!endpoints.some((e) => endpointCovers(e, url))) {
        issues.push({
          path: PATHS.manifest,
          code: 'permission-mismatch',
          message: `mcp server "${s.id}" connects to "${url.host}" but permissions.network.endpoints [${endpoints.join(', ')}] does not include it`,
        });
      }
    }
  }
  return issues;
}

/**
 * The manifest is what an installer shows the user before consenting, so it must describe the
 * content truthfully: component ids/counts and the permissions implied by MCP servers.
 * Throws BundleFormatError if a component file is malformed.
 */
function manifestContentIssues(manifest: Manifest, bundle: Bundle): Issue[] {
  const c = manifest.components;
  const servers = bundle.mcpServers();
  const identityIssues: Issue[] =
    !c.identity && bundle.has(PATHS.persona)
      ? [
          {
            path: PATHS.manifest,
            code: 'manifest-mismatch',
            message: 'components.identity is false but identity/persona.md is present',
          },
        ]
      : []; // identity=true without persona.md is a layout error (checked above)
  return [
    ...identityIssues,
    ...countIssue('memory.facts', c.memory.facts, bundle.memoryFacts().length),
    ...countIssue('memory.episodic', c.memory.episodic, bundle.memoryEpisodic().length),
    ...countIssue('memory.hasProfile', c.memory.hasProfile, bundle.has(PATHS.profile)),
    // Declared-but-missing skills are layout errors (checked above).
    ...undeclaredIssues('skills', new Set(c.skills), bundle.skillNames()),
    ...idListIssues(
      'mcp',
      c.mcp,
      servers.map((s) => s.id),
    ),
    ...idListIssues(
      'tools',
      c.tools,
      bundle.tools().map((t) => t.id),
    ),
    ...idListIssues(
      'tasks',
      c.tasks,
      bundle.tasks().map((t) => t.id),
    ),
    ...idListIssues(
      'channels',
      c.channels,
      bundle.channels().map((ch) => ch.id),
    ),
    ...mcpPermissionIssues(manifest, servers),
  ];
}

export function assertValid(bundle: Bundle): void {
  const result = validateBundle(bundle);
  if (!result.ok) throw new BundleValidationError(result.errors);
}
