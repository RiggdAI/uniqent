import { Bundle, PATHS } from './bundle.js';
import { scanForSecrets } from './secret-scan.js';
import { BundleValidationError } from './errors.js';

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
  }

  // 4. Secret-scan.
  for (const f of scanForSecrets(bundle)) {
    errors.push({
      path: f.path,
      code: 'secret',
      message: `possible ${f.kind} secret (${f.snippet})`,
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function assertValid(bundle: Bundle): void {
  const result = validateBundle(bundle);
  if (!result.ok) throw new BundleValidationError(result.errors);
}
