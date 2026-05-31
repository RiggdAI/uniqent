import { readFile, writeFile, stat } from 'node:fs/promises';
import { unpack, verify, pack as packBundle, readDir, validateBundle } from '@uniqent/core';
import type { Bundle } from '@uniqent/core';
import type { Adapter, ResolvedCredentials } from '@uniqent/adapter-sdk';
import { claudeCodeAdapter } from '@uniqent/adapter-claude-code';
import { hermesAdapter } from '@uniqent/adapter-hermes';
import { openClawAdapter } from '@uniqent/adapter-openclaw';

export interface CliIo {
  log: (msg: string) => void;
  error: (msg: string) => void;
  /** Interactive prompt; omit in non-interactive contexts (credentials must come from flags/env). */
  prompt?: (question: string) => Promise<string>;
}

const ADAPTERS: Record<string, Adapter> = {
  'claude-code': claudeCodeAdapter,
  hermes: hermesAdapter,
  openclaw: openClawAdapter,
};

const BOOLEAN_FLAGS = new Set(['yes', 'allow-unsigned']);

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
  creds: Record<string, string>;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  const creds: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (key === 'cred') {
        const v = args[++i] ?? '';
        const eq = v.indexOf('=');
        if (eq > 0) creds[v.slice(0, eq)] = v.slice(eq + 1);
      } else if (BOOLEAN_FLAGS.has(key)) {
        flags[key] = true;
      } else {
        const next = args[i + 1];
        if (next !== undefined && !next.startsWith('--')) flags[key] = args[++i] as string;
        else flags[key] = true;
      }
    } else if (a === '-o') {
      flags.out = args[++i] ?? '';
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags, creds };
}

/** Load a bundle from a local file path or an http(s) URL. */
async function loadBundle(target: string): Promise<Bundle> {
  if (/^https?:\/\//.test(target)) {
    const res = await fetch(target);
    if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
    return unpack(new Uint8Array(await res.arrayBuffer()));
  }
  return unpack(new Uint8Array(await readFile(target)));
}

/** Load a bundle for validate/pack: a directory (canonical layout) or a packed file. */
async function loadDirOrFile(target: string): Promise<Bundle> {
  const isDir = await stat(target)
    .then((s) => s.isDirectory())
    .catch(() => false);
  return isDir ? readDir(target) : unpack(new Uint8Array(await readFile(target)));
}

async function inspect(args: string[], io: CliIo): Promise<number> {
  const { positionals } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    io.error('inspect: missing <file.uniqent>');
    return 1;
  }
  const bundle = await loadBundle(file);
  const m = bundle.manifest();
  const v = await verify(bundle);
  io.log(`${m.displayName}  (${m.name}@${m.version})`);
  if (m.description) io.log(m.description);
  io.log(`signature: ${v.signed ? (v.valid ? 'valid ✓' : 'INVALID ✗') : 'unsigned'}`);
  io.log(
    `components: identity=${m.components.identity} skills=${m.components.skills.length} mcp=${m.components.mcp.length} memory=${m.components.memory.facts} tasks=${m.components.tasks.length} channels=${m.components.channels.length}`,
  );
  io.log(
    `permissions: network=[${m.permissions.network.endpoints.join(', ')}] autonomy=${m.permissions.autonomy} spawnsProcesses=${m.permissions.spawnsProcesses}`,
  );
  if (m.credentials.length > 0) {
    io.log('credentials:');
    for (const c of m.credentials) {
      io.log(`  - ${c.ref} (${c.type}${c.required ? ', required' : ''}) — ${c.label}`);
    }
  }
  return 0;
}

async function install(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags, creds } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    io.error('install: missing <file.uniqent>');
    return 1;
  }
  const target = typeof flags.target === 'string' ? flags.target : 'claude-code';
  const adapter = ADAPTERS[target];
  if (!adapter) {
    io.error(
      `install: unknown target "${target}" (available: ${Object.keys(ADAPTERS).join(', ')})`,
    );
    return 1;
  }
  const root = typeof flags.root === 'string' ? flags.root : process.cwd();
  const bundle = await loadBundle(file);

  const v = await verify(bundle);
  if (!v.signed || !v.valid) {
    if (!flags['allow-unsigned']) {
      io.error(
        `install: bundle is ${v.signed ? 'INVALID (tampered)' : 'unsigned'}; refusing. Pass --allow-unsigned to override.`,
      );
      return 1;
    }
    io.log(
      `WARNING: installing an ${v.signed ? 'INVALID' : 'unsigned'} bundle (--allow-unsigned).`,
    );
  } else {
    io.log('signature: valid ✓');
  }

  const plan = await adapter.plan(bundle, { root });
  io.log(`\nPlan — ${adapter.displayName} at ${root}:`);
  for (const w of plan.writes) io.log(`  write ${w.path}  (${w.summary})`);
  if (plan.lossiness.length > 0) {
    io.log('lossiness:');
    for (const l of plan.lossiness) io.log(`  ${l.action}: ${l.component} — ${l.issue}`);
  }

  const resolved: ResolvedCredentials = {};
  for (const ref of plan.requiresCredentials) {
    let value = creds[ref] ?? process.env[`UNIQENT_CRED_${ref.toUpperCase()}`];
    if (!value && io.prompt) value = await io.prompt(`credential "${ref}": `);
    if (!value) {
      io.error(`install: missing credential "${ref}" (pass --cred ${ref}=<value>)`);
      return 1;
    }
    resolved[ref] = value;
  }

  if (!flags.yes && io.prompt) {
    const ans = await io.prompt('Proceed with install? [y/N] ');
    if (ans.trim().toLowerCase() !== 'y') {
      io.log('aborted.');
      return 1;
    }
  }

  const result = await adapter.apply(bundle, plan, resolved, { root });
  io.log(`\nInstalled into ${root}:`);
  for (const w of result.written) io.log(`  ${w}`);
  for (const n of result.notes) io.log(`  note: ${n}`);
  io.log('\nDone. Open the project in Claude Code.');
  return 0;
}

async function validate(args: string[], io: CliIo): Promise<number> {
  const { positionals } = parseArgs(args);
  const target = positionals[0];
  if (!target) {
    io.error('validate: missing <dir|file.uniqent>');
    return 1;
  }
  const result = validateBundle(await loadDirOrFile(target));
  if (result.ok) {
    io.log('valid ✓');
    return 0;
  }
  io.error(`invalid: ${result.errors.length} error(s)`);
  for (const e of result.errors) io.error(`  ${e.code}: ${e.message}`);
  return 1;
}

async function pack(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const dir = positionals[0];
  if (!dir) {
    io.error('pack: missing <dir>');
    return 1;
  }
  const bundle = await readDir(dir);
  const bytes = await packBundle(bundle); // validates + secret-scans (throws on a secret)
  const out = typeof flags.out === 'string' ? flags.out : `${bundle.manifest().name}.uniqent`;
  await writeFile(out, bytes);
  io.log(`packed ${out} (${bytes.length} bytes)`);
  return 0;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'inspect') return inspect(rest, io);
  if (cmd === 'install') return install(rest, io);
  if (cmd === 'validate') return validate(rest, io);
  if (cmd === 'pack') return pack(rest, io);
  io.error('usage: uniqent <inspect|install|validate|pack> <file|dir|url> [options]');
  io.error(
    '  install <file|url> --target <id> --root <dir> --cred <ref>=<value> [--allow-unsigned] [--yes]',
  );
  io.error('  pack <dir> [-o <file>]    validate <dir|file>');
  return cmd ? 1 : 0;
}
