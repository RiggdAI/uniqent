import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { Bundle } from '@uniqent/core';
import type { Adapter } from './types.js';
import { resolveInside } from './paths.js';
import { PathEscapeError } from './pure-paths.js';

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{20,}/,
  /\bgh[posru]_[A-Za-z0-9]{30,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
];

async function readTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const s = await stat(full);
      if (s.isDirectory()) await walk(full);
      else out.set(relative(root, full).split(sep).join('/'), await readFile(full, 'utf8'));
    }
  }
  await walk(root);
  return out;
}

export interface ConformanceCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface ConformanceResult {
  ok: boolean;
  checks: ConformanceCheck[];
}

/**
 * Run an adapter through the conformance contract against a sandbox `root`:
 * apply twice with dummy credentials and assert idempotency, no secret values on disk,
 * every planned/written path inside `root`, and that unsupported components (tools, channels,
 * tasks, episodic memory, runtime config) are represented or declared in `plan.lossiness`.
 */
export async function runConformance(
  adapter: Adapter,
  bundle: Bundle,
  root: string,
): Promise<ConformanceResult> {
  const checks: ConformanceCheck[] = [];

  const plan = await adapter.plan(bundle, { root });
  const resolved = Object.fromEntries(plan.requiresCredentials.map((r) => [r, `test-${r}`]));

  const result1 = await adapter.apply(bundle, plan, resolved, { root });
  const after1 = await readTree(root);
  const result2 = await adapter.apply(bundle, plan, resolved, { root });
  const after2 = await readTree(root);

  // Every planned and reported write must resolve inside root.
  const escaped = [
    ...new Set([...plan.writes.map((w) => w.path), ...result1.written, ...result2.written]),
  ].filter((p) => {
    try {
      resolveInside(root, p);
      return false;
    } catch (err) {
      if (err instanceof PathEscapeError) return true;
      throw err;
    }
  });
  checks.push({
    name: 'all writes stay inside root',
    pass: escaped.length === 0,
    detail: escaped.join(', '),
  });

  const idempotent =
    after1.size === after2.size && [...after1].every(([k, v]) => after2.get(k) === v);
  checks.push({ name: 'apply is idempotent', pass: idempotent });

  let leaked: string | undefined;
  for (const [path, content] of after2) {
    if (SECRET_PATTERNS.some((re) => re.test(content))) {
      leaked = path;
      break;
    }
  }
  checks.push({ name: 'no secret values written to disk', pass: !leaked, detail: leaked });

  // No silent loss: a component present in the bundle must be either represented
  // in the plan (registrations) or declared in lossiness.
  const lossy = plan.lossiness.map((l) => l.component.toLowerCase());
  const declared = (kw: string) => lossy.some((c) => c.includes(kw));
  const silent: string[] = [];
  if (bundle.tools().length > 0 && !declared('tool')) silent.push('tools');
  if (
    bundle.channels().length > 0 &&
    plan.channelRegistrations.length === 0 &&
    !declared('channel')
  ) {
    silent.push('channels');
  }
  // Components with no registration list count as represented when a planned write names them.
  const represented = (kw: string) => plan.writes.some((w) => w.summary.toLowerCase().includes(kw));
  const accounted = (kw: string) => declared(kw) || represented(kw);
  if (bundle.tasks().length > 0 && !accounted('task')) silent.push('tasks');
  if (bundle.memoryEpisodic().length > 0 && !accounted('episodic')) silent.push('episodic memory');
  if (bundle.runtime() !== undefined && !accounted('runtime')) silent.push('runtime config');
  checks.push({
    name: 'no silent loss of components',
    pass: silent.length === 0,
    detail: silent.join(', '),
  });

  return { ok: checks.every((c) => c.pass), checks };
}
