import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import {
  unpack,
  verify,
  sign as signBundle,
  generateKeypair,
  pack as packBundle,
  readDir,
  validateBundle,
  scanForSecrets,
} from '@uniqent/core';
import type { Bundle } from '@uniqent/core';
import type { Adapter, ResolvedCredentials } from '@uniqent/adapter-sdk';
import { claudeCodeAdapter } from '@uniqent/adapter-claude-code';
import { hermesAdapter } from '@uniqent/adapter-hermes';
import { openClawAdapter } from '@uniqent/adapter-openclaw';
import {
  searchMcpHubs,
  searchSkillHubs,
  defaultMcpSources,
  defaultSkillSources,
  Brain,
  importVault,
  parseMemoryMarkdown,
  publishMemoryPack,
  findFeatured,
  featuredBrains,
  detectTarget,
} from '@uniqent/builder';
import type { VaultFile, MemoryPackUpload } from '@uniqent/builder';
import { fetchIndex, findEntry, looksLikeSlug, registryUrl } from './registry.js';
import { loadFeaturedBundle } from './featured.js';

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

const BOOLEAN_FLAGS = new Set(['yes', 'allow-unsigned', 'json', 'sign', 'dry-run', 'list']);

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

async function bundleFromUrl(url: string): Promise<Bundle> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  return unpack(new Uint8Array(await res.arrayBuffer()));
}

/**
 * Resolve an install target into a bundle. A target is one of:
 *  - an http(s) URL to a .uniqent          → fetched directly
 *  - a bare registry slug (e.g. dev-powerpack) → resolved via the registry index, no service
 *  - a local file path                      → read from disk
 */
async function resolveBundle(
  target: string,
  flags: Record<string, string | true>,
): Promise<Bundle> {
  if (/^https?:\/\//.test(target)) return bundleFromUrl(target);
  if (looksLikeSlug(target)) {
    const reg = registryUrl(flags.registry);
    if (!reg) {
      throw new Error(
        `"${target}" looks like a registry slug but no registry is set (pass --registry <url> or set UNIQENT_REGISTRY), or give a file path or URL`,
      );
    }
    const wanted = typeof flags.version === 'string' ? flags.version : undefined;
    const entry = findEntry(await fetchIndex(reg), target, wanted);
    if (!entry)
      throw new Error(`"${target}"${wanted ? `@${wanted}` : ''} not found in registry ${reg}`);
    return bundleFromUrl(entry.url);
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
  const { positionals, flags } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    io.error('inspect: missing <file.uniqent|url|slug>');
    return 1;
  }
  let bundle: Bundle;
  try {
    bundle = await resolveBundle(file, flags);
  } catch (e) {
    io.error(`inspect: ${(e as Error).message}`);
    return 1;
  }
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

interface RunInstallOpts {
  target: string;
  root: string;
  creds: Record<string, string>;
  allowUnsigned: boolean;
  autoYes: boolean;
  dryRun: boolean;
}

/** Shared verify → plan → resolve creds → confirm → apply pipeline for `install` and `try`. */
async function runInstall(bundle: Bundle, opts: RunInstallOpts, io: CliIo): Promise<number> {
  const adapter = ADAPTERS[opts.target];
  if (!adapter) {
    io.error(`unknown target "${opts.target}" (available: ${Object.keys(ADAPTERS).join(', ')})`);
    return 1;
  }

  const v = await verify(bundle);
  if (!v.signed || !v.valid) {
    if (!opts.allowUnsigned) {
      io.error(
        `bundle is ${v.signed ? 'INVALID (tampered)' : 'unsigned'}; refusing. Pass --allow-unsigned to override.`,
      );
      return 1;
    }
    io.log(
      `WARNING: installing an ${v.signed ? 'INVALID' : 'unsigned'} bundle (--allow-unsigned).`,
    );
  } else {
    io.log('signature: valid ✓');
  }

  const plan = await adapter.plan(bundle, { root: opts.root });
  io.log(`\nPlan — ${adapter.displayName} at ${opts.root}:`);
  for (const w of plan.writes) io.log(`  write ${w.path}  (${w.summary})`);
  if (plan.lossiness.length > 0) {
    io.log('lossiness:');
    for (const l of plan.lossiness) io.log(`  ${l.action}: ${l.component} — ${l.issue}`);
  }

  if (opts.dryRun) {
    if (plan.requiresCredentials.length > 0)
      io.log(`requires credentials: ${plan.requiresCredentials.join(', ')}`);
    io.log('\ndry run — nothing written.');
    return 0;
  }

  const resolved: ResolvedCredentials = {};
  for (const ref of plan.requiresCredentials) {
    let value = opts.creds[ref] ?? process.env[`UNIQENT_CRED_${ref.toUpperCase()}`];
    if (!value && io.prompt) value = await io.prompt(`credential "${ref}": `);
    if (!value) {
      io.error(`missing credential "${ref}" (pass --cred ${ref}=<value>)`);
      return 1;
    }
    resolved[ref] = value;
  }

  if (!opts.autoYes && io.prompt) {
    const ans = await io.prompt('Proceed with install? [y/N] ');
    if (ans.trim().toLowerCase() !== 'y') {
      io.log('aborted.');
      return 1;
    }
  }

  const result = await adapter.apply(bundle, plan, resolved, { root: opts.root });
  io.log(`\nInstalled into ${opts.root}:`);
  for (const w of result.written) io.log(`  ${w}`);
  for (const n of result.notes) io.log(`  note: ${n}`);
  return 0;
}

async function install(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags, creds } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    io.error('install: missing <file.uniqent|url|slug>');
    return 1;
  }
  const target = typeof flags.target === 'string' ? flags.target : 'claude-code';
  const root = typeof flags.root === 'string' ? flags.root : process.cwd();
  let bundle: Bundle;
  try {
    bundle = await resolveBundle(file, flags);
  } catch (e) {
    io.error(`install: ${(e as Error).message}`);
    return 1;
  }
  const code = await runInstall(
    bundle,
    {
      target,
      root,
      creds,
      allowUnsigned: flags['allow-unsigned'] === true,
      autoYes: flags.yes === true,
      dryRun: flags['dry-run'] === true,
    },
    io,
  );
  if (code === 0 && !flags['dry-run']) io.log('\nDone. Open the project in Claude Code.');
  return code;
}

function printFeatured(io: CliIo, out: (m: string) => void = (m) => io.log(m)): void {
  out('Featured brains you can try:');
  for (const b of featuredBrains()) out(`  ${b.name} — ${b.pitch}`);
  out('\n  uniqent try <name>');
}

async function tryCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags, creds } = parseArgs(args);

  if (flags.list === true) {
    printFeatured(io);
    return 0;
  }

  const name = positionals[0];
  if (!name) {
    io.error('try: missing <brain>');
    printFeatured(io, (m) => io.error(m));
    return 1;
  }

  const featured = findFeatured(name);
  let bundle: Bundle;
  try {
    bundle = featured ? await loadFeaturedBundle(name) : await resolveBundle(name, flags);
  } catch (e) {
    io.error(`try: couldn't load "${name}": ${(e as Error).message}`);
    if (!featured) printFeatured(io, (m) => io.error(m));
    return 1;
  }

  // Print brain identity.
  const manifestBytes = bundle.get('uniqent.json');
  const manifestData = manifestBytes
    ? (JSON.parse(new TextDecoder().decode(manifestBytes)) as {
        displayName?: string;
        description?: string;
      })
    : undefined;
  if (manifestData?.displayName)
    io.log(
      `${manifestData.displayName}${manifestData.description ? ` — ${manifestData.description}` : ''}`,
    );

  // Resolve target + root: explicit flags win, else auto-detect, else default claude-code in cwd.
  let target: string | undefined = typeof flags.target === 'string' ? flags.target : undefined;
  let root: string | undefined = typeof flags.root === 'string' ? flags.root : undefined;
  if (!target || !root) {
    const guess = await detectTarget({
      cwd: root ?? process.cwd(),
      home: homedir(),
      env: process.env,
    });
    if (guess) {
      target = target ?? guess.id;
      root = root ?? guess.configRoot;
      io.log(`detected: ${ADAPTERS[guess.id]?.displayName ?? guess.id} (${guess.configRoot})`);
    } else {
      target = target ?? 'claude-code';
      root = root ?? process.cwd();
      io.log(
        `no agent detected — setting up ${ADAPTERS[target]?.displayName ?? target} in ${root}`,
      );
    }
  }
  // Both are guaranteed to be set by the if block above.
  const resolvedTarget = target as string;
  const resolvedRoot = root as string;

  const code = await runInstall(
    bundle,
    {
      target: resolvedTarget,
      root: resolvedRoot,
      creds,
      allowUnsigned: flags['allow-unsigned'] === true,
      autoYes: flags.yes === true,
      dryRun: flags['dry-run'] === true,
    },
    io,
  );
  if (code !== 0 || flags['dry-run']) return code;

  // The payoff: surface the brain's suggested prompts.
  const prompts: string[] =
    (manifestData as { suggestedPrompts?: string[] } | undefined)?.suggestedPrompts ?? [];
  io.log(
    `\nDone. Open this folder in ${ADAPTERS[resolvedTarget]?.displayName ?? resolvedTarget} and ask:`,
  );
  if (prompts.length) for (const p of prompts) io.log(`  → "${p}"`);
  else io.log('  → ask it anything in its wheelhouse.');
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
  const bundle = await maybeSign(await readDir(dir), flags, io);
  const bytes = await packBundle(bundle); // validates + secret-scans (throws on a secret)
  const out = typeof flags.out === 'string' ? flags.out : `${bundle.manifest().name}.uniqent`;
  await writeFile(out, bytes);
  const v = await verify(bundle);
  io.log(`packed ${out} (${bytes.length} bytes${v.signed ? ', signed ✓' : ''})`);
  return 0;
}

async function search(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const reg = registryUrl(flags.registry);
  if (!reg) {
    io.error('search: no registry set (pass --registry <url> or set UNIQENT_REGISTRY)');
    return 1;
  }
  const q = (positionals[0] ?? '').toLowerCase();
  const index = await fetchIndex(reg);
  const hits = index.bundles.filter((e) =>
    !q
      ? true
      : `${e.name} ${e.description ?? ''} ${(e.tags ?? []).join(' ')}`.toLowerCase().includes(q),
  );
  if (hits.length === 0) {
    io.log(q ? `no bundles match "${q}"` : 'registry is empty');
    return 0;
  }
  for (const e of hits) {
    const tags = e.tags && e.tags.length > 0 ? `  [${e.tags.join(', ')}]` : '';
    io.log(`${e.name}@${e.version ?? '?'}  ${e.description ?? ''}${tags}`);
  }
  io.log(`\nInstall one with:  uniqent install <name> --registry ${reg} --target <id>`);
  return 0;
}

function jsonIndexUrls(flags: Record<string, string | true>): string[] {
  return typeof flags.index === 'string'
    ? flags.index
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

async function hub(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const kind = positionals[0];
  const query = positionals.slice(1).join(' ');
  const indexes = jsonIndexUrls(flags);

  if (kind === 'mcp') {
    const { results, errors } = await searchMcpHubs(
      query,
      defaultMcpSources({ jsonIndexUrls: indexes }),
    );
    if (flags.json) {
      io.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      io.log(query ? `no MCP servers match "${query}"` : 'no results');
    } else {
      for (const r of results) {
        const pop = typeof r.popularity === 'number' ? `  (${r.popularity} uses)` : '';
        const creds =
          r.credentials.length > 0 ? `  needs ${r.credentials.map((c) => c.ref).join(', ')}` : '';
        io.log(
          `${r.entry.id}  [${r.source}]  ${r.entry.name} — ${r.entry.description}${pop}${creds}`,
        );
      }
    }
    for (const e of errors) io.error(`  (hub ${e.source} unavailable: ${e.message})`);
    return 0;
  }

  if (kind === 'skills') {
    const { results, errors } = await searchSkillHubs(
      query,
      defaultSkillSources({ jsonIndexUrls: indexes }),
    );
    if (flags.json) {
      io.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      io.log(query ? `no skills match "${query}"` : 'no results');
    } else {
      for (const r of results) {
        const stars = typeof r.stars === 'number' ? `  ★${r.stars}` : '';
        io.log(`${r.name}  [${r.source}]${stars}  ${r.description}`);
        if (r.skillUrl) io.log(`    SKILL.md: ${r.skillUrl}`);
      }
    }
    for (const e of errors) io.error(`  (hub ${e.source} unavailable: ${e.message})`);
    return 0;
  }

  io.error('usage: uniqent hub <mcp|skills> <query> [--index <url,url>] [--json]');
  return 1;
}

/** Read a hex private key from a keyfile written by `keygen`. */
async function loadPrivateKey(path: string): Promise<string> {
  const kp = JSON.parse(await readFile(path, 'utf8')) as { privateKey?: string };
  if (!kp.privateKey) throw new Error(`${path} has no "privateKey"`);
  return kp.privateKey;
}

/** Sign the bundle if --key (stable identity) or --sign (ephemeral, integrity-only) was passed. */
async function maybeSign(
  bundle: Bundle,
  flags: Record<string, string | true>,
  io: CliIo,
): Promise<Bundle> {
  if (!flags.sign && typeof flags.key !== 'string') return bundle;
  if (typeof flags.key === 'string') return signBundle(bundle, await loadPrivateKey(flags.key));
  const kp = await generateKeypair();
  io.log(
    `signing with an ephemeral key (integrity only; pubkey ${kp.publicKey.slice(0, 16)}…). Use --key <keyfile> for a stable publisher identity.`,
  );
  return signBundle(bundle, kp.privateKey);
}

async function keygen(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args);
  const out = typeof flags.out === 'string' ? flags.out : 'uniqent.key.json';
  if (await pathExists(out)) {
    io.error(`keygen: ${out} already exists; pass -o <file> or remove it (do not overwrite a key)`);
    return 1;
  }
  const kp = await generateKeypair();
  await writeFile(out, JSON.stringify(kp, null, 2) + '\n');
  io.log(`wrote ${out}`);
  io.log(`public key: ${kp.publicKey}`);
  io.log(
    `Keep ${out} secret and out of git (add it to .gitignore). Sign with: uniqent sign <file> --key ${out}`,
  );
  return 0;
}

async function signCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    io.error('sign: missing <file.uniqent>');
    return 1;
  }
  if (typeof flags.key !== 'string') {
    io.error('sign: missing --key <keyfile> (create one with: uniqent keygen)');
    return 1;
  }
  let signed: Bundle;
  try {
    const bundle = await unpack(new Uint8Array(await readFile(file)));
    signed = await signBundle(bundle, await loadPrivateKey(flags.key));
  } catch (e) {
    io.error(`sign: ${(e as Error).message}`);
    return 1;
  }
  const out = typeof flags.out === 'string' ? flags.out : file;
  await writeFile(out, await packBundle(signed));
  const v = await verify(signed);
  io.log(
    `signed ${out} — signature ${v.valid ? 'valid ✓' : 'INVALID'} (pubkey ${v.publicKey?.slice(0, 16)}…)`,
  );
  return 0;
}

async function pathExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}

/** Best-effort framework detection from marker files, so `--from` is optional. */
async function detectExportTarget(root: string): Promise<string[]> {
  const hits: string[] = [];
  if ((await pathExists(`${root}/.claude`)) || (await pathExists(`${root}/.mcp.json`)))
    hits.push('claude-code');
  if (await pathExists(`${root}/hermes.json`)) hits.push('hermes');
  if (await pathExists(`${root}/openclaw.json`)) hits.push('openclaw');
  return hits;
}

async function exportCmd(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args);
  const root = typeof flags.root === 'string' ? flags.root : process.cwd();

  let target = typeof flags.from === 'string' ? flags.from : undefined;
  if (!target) {
    const hits = await detectExportTarget(root);
    if (hits.length === 1) {
      target = hits[0]!;
      io.log(`detected ${target} at ${root}`);
    } else if (hits.length === 0) {
      io.error(
        `export: no known framework found at ${root}; pass --from <claude-code|hermes|openclaw>`,
      );
      return 1;
    } else {
      io.error(`export: multiple frameworks found (${hits.join(', ')}); pass --from <id>`);
      return 1;
    }
  }
  const adapter = ADAPTERS[target];
  if (!adapter) {
    io.error(
      `export: unknown framework "${target}" (available: ${Object.keys(ADAPTERS).join(', ')})`,
    );
    return 1;
  }

  let bundle: Bundle;
  try {
    bundle = await adapter.export({ root });
  } catch (e) {
    io.error(`export: ${(e as Error).message}`);
    return 1;
  }

  const m = bundle.manifest();
  io.log(`\nCaptured from ${adapter.displayName} at ${root}:`);
  io.log(
    `  identity=${m.components.identity} skills=${m.components.skills.length} mcp=${m.components.mcp.length} memory=${m.components.memory.facts} channels=${m.components.channels.length} tasks=${m.components.tasks.length}`,
  );
  if (m.credentials.length > 0)
    io.log(`  credentials to re-supply on install: ${m.credentials.map((c) => c.ref).join(', ')}`);

  const result = validateBundle(bundle);
  if (!result.ok) {
    io.error(
      `export: captured bundle is invalid: ${result.errors.map((e) => e.message).join('; ')}`,
    );
    return 1;
  }
  const findings = scanForSecrets(bundle);
  if (findings.length > 0) {
    io.error(
      `export: capture pulled in ${findings.length} likely secret(s) (e.g. ${findings[0]?.kind}); refusing to write. This is a capture bug — secrets must be scrubbed to credential refs.`,
    );
    return 1;
  }

  const out = typeof flags.out === 'string' ? flags.out : `${m.name}.uniqent`;
  const signed = await maybeSign(bundle, flags, io);
  await writeFile(out, await packBundle(signed));
  const v = await verify(signed);
  io.log(
    `\nwrote ${out} (${v.signed ? 'signed ✓' : 'unsigned'}). Inspect with: uniqent inspect ${out}`,
  );
  return 0;
}

/** Walk a folder for markdown notes (POSIX-relative paths), skipping VCS/tooling/dot dirs. */
async function readVaultDir(dir: string): Promise<VaultFile[]> {
  const SKIP = new Set(['.git', '.obsidian', 'node_modules', '.trash']);
  const files: VaultFile[] = [];
  const walk = async (abs: string): Promise<void> => {
    if (files.length >= 5000) return;
    for (const e of await readdir(abs, { withFileTypes: true })) {
      if (files.length >= 5000) break;
      if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
      const child = join(abs, e.name);
      if (e.isDirectory()) await walk(child);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md'))
        files.push({
          path: relative(dir, child).split(sep).join('/'),
          content: await readFile(child, 'utf8'),
        });
    }
  };
  await walk(dir);
  return files;
}

function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || 'brain';
}

/** Capture an Obsidian / second-brain vault folder into a canonical .uniqent bundle. */
async function importVaultCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const dir = positionals[0];
  if (!dir) {
    io.error('import-vault: missing <dir>');
    return 1;
  }
  let files: VaultFile[];
  try {
    files = await readVaultDir(dir);
  } catch (e) {
    io.error(`import-vault: cannot read ${dir}: ${(e as Error).message}`);
    return 1;
  }
  const result = importVault(files);
  const name = slugify(
    typeof flags.name === 'string' ? flags.name : basename(dir.replace(/\/+$/, '')),
  );
  const brain = Brain.create({
    name,
    displayName:
      typeof flags.name === 'string' ? flags.name : basename(dir.replace(/\/+$/, '')) || name,
    version: typeof flags.version === 'string' ? flags.version : '0.1.0',
    description:
      typeof flags.description === 'string' ? flags.description : `Imported from ${basename(dir)}`,
    author: { name: typeof flags.author === 'string' ? flags.author : 'unknown' },
    license: 'CC0-1.0',
    tags: [],
  });
  if (result.persona) brain.setPersona(result.persona);
  if (result.profile) brain.setProfile(result.profile);
  let i = 0;
  for (const it of result.items)
    brain.addMemory({
      id: `fact-${++i}`,
      kind: it.kind,
      text: it.text,
      source: it.source,
      createdAt: new Date().toISOString(),
    });

  const bundle = brain.toBundle();
  const valid = validateBundle(bundle);
  if (!valid.ok) {
    io.error(
      `import-vault: produced an invalid bundle: ${valid.errors.map((e) => e.message).join('; ')}`,
    );
    return 1;
  }
  const findings = scanForSecrets(bundle);
  if (findings.length > 0) {
    io.error(
      `import-vault: the vault contains ${findings.length} likely secret(s) (e.g. ${findings[0]?.kind}); refusing to pack. Remove secrets from your notes.`,
    );
    return 1;
  }

  io.log(`Captured ${name} from ${dir}:`);
  io.log(
    `  ${result.stats.files} file(s) · persona=${result.persona ? result.stats.personaFrom : 'none'} · profile=${result.profile ? `${result.stats.profileFrom}` : 'none'} · memory=${result.stats.items} (${result.stats.episodic} episodic)`,
  );

  const signed = await maybeSign(bundle, flags, io);
  const out = typeof flags.out === 'string' ? flags.out : `${name}.uniqent`;
  await writeFile(out, await packBundle(signed));
  const v = await verify(signed);
  io.log(
    `wrote ${out} (${v.signed ? 'signed ✓' : 'unsigned'}). Inspect with: uniqent inspect ${out}`,
  );
  return 0;
}

const DEFAULT_HUB = 'https://uniqent.ai';

/** Publish a memory pack to a hosted hub (default uniqent.ai). Accepts a .json pack or .md/.txt. */
async function publishMemoryCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args);
  const file = positionals[0];
  if (!file) {
    io.error('publish-memory: missing <pack.json|notes.md>');
    return 1;
  }
  const token = typeof flags.token === 'string' ? flags.token : process.env.UNIQENT_PUBLISH_TOKEN;
  if (!token) {
    io.error('publish-memory: missing --token <value> (or set UNIQENT_PUBLISH_TOKEN)');
    return 1;
  }
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;

  let pack: MemoryPackUpload;
  try {
    const raw = await readFile(file, 'utf8');
    if (file.endsWith('.json')) {
      const parsed = JSON.parse(raw) as Partial<MemoryPackUpload> & {
        facts?: MemoryPackUpload['facts'];
      };
      const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
      pack = {
        slug: (typeof flags.slug === 'string' ? flags.slug : parsed.slug) ?? '',
        name: (typeof flags.name === 'string' ? flags.name : parsed.name) ?? '',
        description: typeof flags.description === 'string' ? flags.description : parsed.description,
        tags: typeof flags.tags === 'string' ? splitCsv(flags.tags) : parsed.tags,
        facts,
      };
    } else {
      // markdown/text → facts (kinds + [[links]]/#tags preserved); slug/name from flags
      const items = parseMemoryMarkdown(raw);
      pack = {
        slug: typeof flags.slug === 'string' ? flags.slug : '',
        name: typeof flags.name === 'string' ? flags.name : '',
        description: typeof flags.description === 'string' ? flags.description : undefined,
        tags: typeof flags.tags === 'string' ? splitCsv(flags.tags) : undefined,
        facts: items.map((it) => ({ kind: it.kind, text: it.text })),
      };
    }
  } catch (e) {
    io.error(`publish-memory: cannot read ${file}: ${(e as Error).message}`);
    return 1;
  }
  if (!pack.slug || !pack.name) {
    io.error(
      'publish-memory: slug and name required (pass --slug and --name, or set them in the .json)',
    );
    return 1;
  }

  try {
    const r = await publishMemoryPack(registry, token, pack);
    io.log(
      `published ${r.slug} (${r.factCount} fact(s))${r.url ? ` → ${r.url}` : ''}${r.persisted === false ? ' (stored, not indexed)' : ''}`,
    );
    return 0;
  } catch (e) {
    io.error(`publish-memory: ${(e as Error).message}`);
    return 1;
  }
}

function splitCsv(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === 'try') return tryCmd(rest, io);
  if (cmd === 'inspect') return inspect(rest, io);
  if (cmd === 'install') return install(rest, io);
  if (cmd === 'validate') return validate(rest, io);
  if (cmd === 'pack') return pack(rest, io);
  if (cmd === 'search') return search(rest, io);
  if (cmd === 'hub') return hub(rest, io);
  if (cmd === 'export') return exportCmd(rest, io);
  if (cmd === 'import-vault') return importVaultCmd(rest, io);
  if (cmd === 'publish-memory') return publishMemoryCmd(rest, io);
  if (cmd === 'keygen') return keygen(rest, io);
  if (cmd === 'sign') return signCmd(rest, io);
  io.error(
    'usage: uniqent <try|inspect|install|validate|pack|search|hub|export|import-vault|publish-memory|keygen|sign> <file|dir|url|slug|query> [options]',
  );
  io.error(
    '  try <brain> [--target <id>] [--root <dir>] [--yes] [--list]   (one-command install of a featured brain)',
  );
  io.error(
    '  install <file|url|slug> --target <id> --root <dir> --cred <ref>=<value> [--registry <url>] [--allow-unsigned] [--yes]',
  );
  io.error('  pack <dir> [-o <file>]    validate <dir|file>    search <query> --registry <url>');
  io.error('  hub <mcp|skills> <query> [--index <url,url>] [--json]');
  io.error(
    '  export [--from <claude-code|hermes|openclaw>] --root <dir> [-o <file>] [--sign|--key <k>]',
  );
  io.error(
    '  import-vault <dir> [--name <n>] [-o <file>] [--sign|--key <k>]   (Obsidian/second-brain → .uniqent)',
  );
  io.error(
    '  publish-memory <pack.json|notes.md> --slug <s> --name <n> [--registry <site>] [--token <t>] [--tags a,b]',
  );
  io.error('  keygen [-o <keyfile>]    sign <file> --key <keyfile> [-o]    install … --dry-run');
  return cmd ? 1 : 0;
}
