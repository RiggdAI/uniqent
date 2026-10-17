import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  unpack,
  verify,
  sign as signBundle,
  generateKeypair,
  pack as packBundle,
  readDir,
  validateBundle,
  scanForSecrets,
  publicKeyFingerprint,
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
  publishBundle,
  findFeatured,
  featuredBrains,
  detectTarget,
  AmbiguousTargetError,
  hasNoComponents,
} from '@uniqent/builder';
import type { VaultFile, MemoryPackUpload, TargetGuess } from '@uniqent/builder';
import { saveToken, clearToken, resolveToken } from './credentials.js';
import { runDeviceLogin } from './device.js';
import { fetchIndex, findEntry, isUrl, looksLikeSlug, registryUrl } from './registry.js';
import type { RegistryIndex } from './registry.js';
import { loadFeaturedBundle } from './featured.js';
import { parseArgs, wantsHelp, UsageError, type FlagSpec } from './args.js';
import { download } from './download.js';
import { safe, describeMcpServers, describeIssues } from './display.js';
import { defaultRoot, nextStep } from './targets.js';

export interface CliIo {
  log: (msg: string) => void;
  error: (msg: string) => void;
  /**
   * Interactive prompt; present only on a TTY. Without it, commands never block on stdin:
   * confirmations need --yes and credentials need --cred / UNIQENT_CRED_<REF>.
   */
  prompt?: (question: string) => Promise<string>;
  /** Like `prompt`, but the typed answer is not echoed (for credential values). */
  promptSecret?: (question: string) => Promise<string>;
}

const ADAPTERS: Record<string, Adapter> = {
  'claude-code': claudeCodeAdapter,
  hermes: hermesAdapter,
  openclaw: openClawAdapter,
};

/** Flags each command accepts; anything else is a usage error. */
const FLAGS: Record<string, FlagSpec> = {
  try: {
    boolean: ['yes', 'allow-unsigned', 'dry-run', 'list'],
    value: ['target', 'root', 'registry', 'version'],
    cred: true,
  },
  inspect: { boolean: [], value: ['registry', 'version'], cred: false },
  install: {
    boolean: ['yes', 'allow-unsigned', 'dry-run'],
    value: ['target', 'root', 'registry', 'version'],
    cred: true,
  },
  validate: { boolean: [], value: [], cred: false },
  pack: { boolean: ['sign'], value: ['out', 'key'], cred: false },
  search: { boolean: [], value: ['registry'], cred: false },
  hub: { boolean: ['json'], value: ['index'], cred: false },
  export: { boolean: ['sign'], value: ['from', 'root', 'out', 'key'], cred: false },
  'import-vault': {
    boolean: ['sign'],
    value: ['name', 'version', 'description', 'author', 'out', 'key'],
    cred: false,
  },
  'publish-memory': {
    boolean: [],
    value: ['registry', 'token', 'slug', 'name', 'description', 'tags'],
    cred: false,
  },
  publish: { boolean: ['sign'], value: ['registry', 'token', 'key'], cred: false },
  login: { boolean: [], value: ['registry', 'token'], cred: false },
  logout: { boolean: [], value: ['registry'], cred: false },
  keygen: { boolean: [], value: ['out'], cred: false },
  sign: { boolean: [], value: ['key', 'out'], cred: false },
};

/** Per-command usage, shown by `<cmd> --help` and in the top-level usage. */
const USAGE: Record<string, string> = {
  try: 'try <brain> [--target <id>] [--root <dir>] [--cred <ref>=<value>] [--yes] [--dry-run] [--list]   (one-command install of a featured brain)',
  inspect: 'inspect <file|url|slug> [--registry <url|file>] [--version <v>]',
  install:
    'install <file|url|slug> [--target <claude-code|hermes|openclaw>] [--root <dir>] [--cred <ref>=<value>] [--registry <url|file>] [--version <v>] [--allow-unsigned] [--dry-run] [--yes]',
  validate: 'validate <dir|file.uniqent>',
  pack: 'pack <dir> [-o <file>] [--sign|--key <keyfile>]',
  search: 'search <query> --registry <url|file>',
  hub: 'hub <mcp|skills> <query> [--index <url,url>] [--json]',
  export:
    'export [--from <claude-code|hermes|openclaw>] --root <dir> [-o <file>] [--sign|--key <keyfile>]',
  'import-vault':
    'import-vault <dir> [--name <n>] [--version <v>] [--description <d>] [--author <a>] [-o <file>] [--sign|--key <keyfile>]   (Obsidian/second-brain → .uniqent)',
  'publish-memory':
    'publish-memory <pack.json|notes.md> --slug <s> --name <n> [--description <d>] [--registry <site>] [--token <t>] [--tags a,b]',
  publish: 'publish <file.uniqent|dir> [--registry <site>] [--token <t>] [--sign|--key <keyfile>]',
  login: 'login [--registry <site>] [--token <t>]',
  logout: 'logout [--registry <site>]',
  keygen: 'keygen [-o <keyfile>]',
  sign: 'sign <file.uniqent> --key <keyfile> [-o <file>]',
};

/** Unpack archive bytes, turning a non-gzip payload into a clear "not a .uniqent" error. */
async function unpackFrom(bytes: Uint8Array, source: string): Promise<Bundle> {
  try {
    return await unpack(bytes);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (typeof code === 'string' && code.startsWith('Z_'))
      throw new Error(`not a .uniqent (gzip) file: ${source}`, { cause: e });
    throw e;
  }
}

async function bundleFromUrl(url: string, io: CliIo): Promise<Bundle> {
  return unpackFrom(await download(url, io.error), url);
}

async function bundleFromFile(path: string): Promise<Bundle> {
  return unpackFrom(new Uint8Array(await readFile(path)), path);
}

/**
 * Resolve an install target into a bundle. A target is one of:
 *  - an https URL to a .uniqent (http only on loopback) → downloaded
 *  - an existing local file path                         → read from disk
 *  - a bare registry slug (e.g. dev-powerpack)           → resolved via the registry index
 */
async function resolveBundle(
  target: string,
  flags: Record<string, string | true>,
  io: CliIo,
): Promise<Bundle> {
  if (isUrl(target)) return bundleFromUrl(target, io);
  if (await pathExists(target)) return bundleFromFile(target);
  if (looksLikeSlug(target)) {
    const reg = registryUrl(flags.registry);
    if (!reg) {
      throw new Error(
        `"${target}" looks like a registry slug but no registry is set (pass --registry <url|file> or set UNIQENT_REGISTRY), or give a file path or URL`,
      );
    }
    const wanted = typeof flags.version === 'string' ? flags.version : undefined;
    const entry = findEntry(await fetchIndex(reg, io.error), target, wanted);
    if (!entry)
      throw new Error(`"${target}"${wanted ? `@${wanted}` : ''} not found in registry ${reg}`);
    return bundleFromUrl(entry.url, io);
  }
  throw new Error(`no such file: ${target}`);
}

/** Load a bundle for validate/pack: a directory (canonical layout) or a packed file. */
async function loadDirOrFile(target: string): Promise<Bundle> {
  const isDir = await stat(target)
    .then((s) => s.isDirectory())
    .catch(() => false);
  return isDir ? readDir(target) : bundleFromFile(target);
}

/** Validate a loaded bundle; print readable problems and return false when it is invalid. */
function reportInvalid(bundle: Bundle, cmd: string, io: CliIo): boolean {
  const result = validateBundle(bundle);
  if (result.ok) return false;
  const lines = describeIssues(result.errors);
  io.error(`${cmd}: invalid bundle (${lines.length} error(s)):`);
  for (const line of lines) io.error(`  ${line}`);
  return true;
}

/** "signed by <fingerprint>" line; any key can sign, so the fingerprint is what to compare. */
function signerLine(publicKey: string): string {
  return `signed by key ${publicKeyFingerprint(publicKey)} (anyone can sign; compare this fingerprint with the one the publisher advertises)`;
}

async function inspect(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args, FLAGS.inspect as FlagSpec);
  const file = positionals[0];
  if (!file) {
    io.error('inspect: missing <file.uniqent|url|slug>');
    return 1;
  }
  let bundle: Bundle;
  try {
    bundle = await resolveBundle(file, flags, io);
  } catch (e) {
    io.error(`inspect: ${(e as Error).message}`);
    return 1;
  }
  if (reportInvalid(bundle, 'inspect', io)) return 1;
  const m = bundle.manifest();
  const v = await verify(bundle);
  io.log(`${safe(m.displayName)}  (${m.name}@${m.version})`);
  if (m.description) io.log(safe(m.description));
  io.log(
    `signature: ${v.signed ? (v.valid ? 'valid ✓' : `INVALID ✗ (${v.reason ?? 'unknown reason'})`) : 'unsigned'}`,
  );
  if (v.signed && v.publicKey) io.log(`  ${signerLine(v.publicKey)}`);
  io.log(
    `components: identity=${m.components.identity} skills=${m.components.skills.length} mcp=${m.components.mcp.length} memory=${m.components.memory.facts} tasks=${m.components.tasks.length} channels=${m.components.channels.length}`,
  );
  io.log(
    `permissions: network=[${m.permissions.network.endpoints.map(safe).join(', ')}] autonomy=${m.permissions.autonomy} spawnsProcesses=${m.permissions.spawnsProcesses}`,
  );
  const mcp = describeMcpServers(bundle);
  if (mcp.length > 0) {
    io.log('mcp servers:');
    for (const line of mcp) io.log(`  - ${line}`);
  }
  if (m.credentials.length > 0) {
    io.log('credentials:');
    for (const c of m.credentials) {
      io.log(
        `  - ${safe(c.ref)} (${c.type}${c.required ? ', required' : ', optional'}) — ${safe(c.label)}`,
      );
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
  if (reportInvalid(bundle, 'install', io)) return 1;

  const v = await verify(bundle);
  if (v.signed && !v.valid) {
    // Never overridable: a broken signature means the content changed after signing.
    io.error(
      `bundle signature is INVALID (${v.reason ?? 'unknown reason'}): it was modified after signing; refusing to install. --allow-unsigned does not override an invalid signature.`,
    );
    return 1;
  }
  if (!v.signed) {
    if (!opts.allowUnsigned) {
      io.error('bundle is unsigned; refusing. Pass --allow-unsigned to override.');
      return 1;
    }
    io.log('WARNING: installing an unsigned bundle (--allow-unsigned).');
  } else {
    io.log('signature: valid ✓');
    if (v.publicKey) io.log(`  ${signerLine(v.publicKey)}`);
  }

  const plan = await adapter.plan(bundle, { root: opts.root });
  io.log(`\nPlan — ${adapter.displayName} at ${opts.root}:`);
  for (const w of plan.writes) io.log(`  write ${safe(w.path)}  (${safe(w.summary)})`);
  const mcp = describeMcpServers(bundle);
  if (mcp.length > 0) {
    io.log('mcp servers (these commands/URLs will be registered with the agent):');
    for (const line of mcp) io.log(`  ${line}`);
  }
  if (plan.lossiness.length > 0) {
    io.log('lossiness:');
    for (const l of plan.lossiness)
      io.log(`  ${l.action}: ${safe(l.component)} — ${safe(l.issue)}`);
  }

  if (opts.dryRun) {
    if (plan.requiresCredentials.length > 0)
      io.log(`requires credentials: ${plan.requiresCredentials.map(safe).join(', ')}`);
    io.log('\ndry run — nothing written.');
    return 0;
  }

  const declared = new Map(bundle.manifest().credentials.map((c) => [c.ref, c]));
  const resolved: ResolvedCredentials = {};
  for (const ref of plan.requiresCredentials) {
    const cred = declared.get(ref);
    const optional = cred?.required === false;
    const envName = `UNIQENT_CRED_${ref.toUpperCase()}`;
    let value = opts.creds[ref] ?? process.env[envName];
    if (!value && io.promptSecret) {
      const label = cred ? ` — ${safe(cred.label)}` : '';
      value = await io.promptSecret(
        `credential "${safe(ref)}"${label}${optional ? ' (optional, Enter to skip)' : ''}: `,
      );
    }
    if (!value && optional) {
      io.log(`  skipping optional credential "${safe(ref)}"`);
      continue;
    }
    if (!value) {
      io.error(
        `missing credential "${safe(ref)}" (pass --cred ${safe(ref)}=<value> or set ${safe(envName)})`,
      );
      return 1;
    }
    resolved[ref] = value;
  }

  if (!opts.autoYes) {
    if (!io.prompt) {
      io.error(
        'not asking for confirmation: stdin is not an interactive terminal. Review the plan (--dry-run), then re-run with --yes to install.',
      );
      return 1;
    }
    const ans = await io.prompt('Proceed with install? [y/N] ');
    if (ans.trim().toLowerCase() !== 'y') {
      io.log('aborted.');
      return 1;
    }
  }

  const result = await adapter.apply(bundle, plan, resolved, { root: opts.root });
  io.log(`\nInstalled into ${opts.root}:`);
  for (const w of result.written) io.log(`  ${safe(w)}`);
  for (const n of result.notes) io.log(`  note: ${safe(n)}`);
  return 0;
}

/** --root default for a known target on this machine (see defaultRoot). */
function rootFor(target: string): string {
  return defaultRoot(target, process.env, homedir(), process.cwd());
}

/** Print an error and return false when `target` names no adapter. */
function knownTarget(cmd: string, target: string, io: CliIo): boolean {
  if (ADAPTERS[target]) return true;
  io.error(`${cmd}: unknown target "${target}" (available: ${Object.keys(ADAPTERS).join(', ')})`);
  return false;
}

async function install(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags, creds } = parseArgs(args, FLAGS.install as FlagSpec);
  const file = positionals[0];
  if (!file) {
    io.error('install: missing <file.uniqent|url|slug>');
    return 1;
  }
  const target = typeof flags.target === 'string' ? flags.target : 'claude-code';
  if (!knownTarget('install', target, io)) return 1;
  const root = typeof flags.root === 'string' ? flags.root : rootFor(target);
  let bundle: Bundle;
  try {
    bundle = await resolveBundle(file, flags, io);
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
  if (code === 0 && !flags['dry-run']) io.log(`\nDone. ${nextStep(target, root)}`);
  return code;
}

function printFeatured(io: CliIo, out: (m: string) => void = (m) => io.log(m)): void {
  out('Featured brains you can try:');
  for (const b of featuredBrains()) out(`  ${b.name} — ${b.pitch}`);
  out('\n  uniqent try <name>');
}

/**
 * Pick where `try` installs: explicit flags win, else auto-detect. With --target but no --root,
 * a detected install of that same framework supplies the root, else the target's default root.
 */
async function resolveTryTarget(
  flags: Record<string, string | true>,
  io: CliIo,
): Promise<{ target: string; root: string } | undefined> {
  const target = typeof flags.target === 'string' ? flags.target : undefined;
  const root = typeof flags.root === 'string' ? flags.root : undefined;
  if (target && root) return { target, root };

  let guess: TargetGuess | null;
  try {
    guess = await detectTarget({ cwd: root ?? process.cwd(), home: homedir(), env: process.env });
  } catch (e) {
    if (!(e instanceof AmbiguousTargetError)) throw e;
    if (target) {
      const match = e.candidates.find((c) => c.id === target);
      return { target, root: root ?? match?.configRoot ?? rootFor(target) };
    }
    io.error('try: found more than one agent framework:');
    for (const c of e.candidates) io.error(`  ${c.id}  (${c.configRoot})`);
    io.error('pick one with --target <id> (and --root <dir> to choose where it installs).');
    return undefined;
  }
  if (guess && (!target || guess.id === target)) {
    io.log(`detected: ${ADAPTERS[guess.id]?.displayName ?? guess.id} (${guess.configRoot})`);
    return { target: guess.id, root: root ?? guess.configRoot };
  }
  if (target) return { target, root: root ?? rootFor(target) };
  const where = root ?? process.cwd();
  io.log(`no agent detected — setting up ${claudeCodeAdapter.displayName} in ${where}`);
  return { target: 'claude-code', root: where };
}

async function tryCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags, creds } = parseArgs(args, FLAGS.try as FlagSpec);

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
    bundle = featured ? await loadFeaturedBundle(name) : await resolveBundle(name, flags, io);
  } catch (e) {
    io.error(`try: couldn't load "${name}": ${(e as Error).message}`);
    if (!featured) printFeatured(io, (m) => io.error(m));
    return 1;
  }
  if (reportInvalid(bundle, 'try', io)) return 1;

  // Print brain identity.
  const manifest = bundle.manifest();
  io.log(
    `${safe(manifest.displayName)}${manifest.description ? ` — ${safe(manifest.description)}` : ''}`,
  );

  if (typeof flags.target === 'string' && !knownTarget('try', flags.target, io)) return 1;
  const picked = await resolveTryTarget(flags, io);
  if (!picked) return 1;

  const code = await runInstall(
    bundle,
    {
      target: picked.target,
      root: picked.root,
      creds,
      allowUnsigned: flags['allow-unsigned'] === true,
      autoYes: flags.yes === true,
      dryRun: flags['dry-run'] === true,
    },
    io,
  );
  if (code !== 0 || flags['dry-run']) return code;

  // The payoff: surface the brain's suggested prompts.
  const prompts = manifest.suggestedPrompts ?? [];
  io.log(`\nDone. ${nextStep(picked.target, picked.root)} Then ask:`);
  if (prompts.length) for (const p of prompts) io.log(`  → "${safe(p)}"`);
  else io.log('  → ask it anything in its wheelhouse.');
  return 0;
}

async function validate(args: string[], io: CliIo): Promise<number> {
  const { positionals } = parseArgs(args, FLAGS.validate as FlagSpec);
  const target = positionals[0];
  if (!target) {
    io.error('validate: missing <dir|file.uniqent>');
    return 1;
  }
  let bundle: Bundle;
  try {
    bundle = await loadDirOrFile(target);
  } catch (e) {
    io.error(`validate: ${(e as Error).message}`);
    return 1;
  }
  const result = validateBundle(bundle);
  if (result.ok) {
    io.log('valid ✓');
    return 0;
  }
  const lines = describeIssues(result.errors);
  io.error(`invalid: ${lines.length} error(s)`);
  for (const line of lines) io.error(`  ${line}`);
  return 1;
}

async function pack(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args, FLAGS.pack as FlagSpec);
  const dir = positionals[0];
  if (!dir) {
    io.error('pack: missing <dir>');
    return 1;
  }
  let source: Bundle;
  try {
    source = await readDir(dir);
  } catch (e) {
    io.error(`pack: ${(e as Error).message}`);
    return 1;
  }
  if (reportInvalid(source, 'pack', io)) return 1;
  const bundle = await maybeSign(source, flags, io);
  const bytes = await packBundle(bundle); // validates + secret-scans (throws on a secret)
  const out = typeof flags.out === 'string' ? flags.out : `${bundle.manifest().name}.uniqent`;
  await writeFile(out, bytes);
  const v = await verify(bundle);
  io.log(`packed ${out} (${bytes.length} bytes${v.signed ? ', signed ✓' : ''})`);
  return 0;
}

async function search(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args, FLAGS.search as FlagSpec);
  const reg = registryUrl(flags.registry);
  if (!reg) {
    io.error('search: no registry set (pass --registry <url|file> or set UNIQENT_REGISTRY)');
    return 1;
  }
  const q = (positionals[0] ?? '').toLowerCase();
  let index: RegistryIndex;
  try {
    index = await fetchIndex(reg, io.error);
  } catch (e) {
    io.error(`search: ${(e as Error).message}`);
    return 1;
  }
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
    const tags = e.tags && e.tags.length > 0 ? `  [${e.tags.map(safe).join(', ')}]` : '';
    io.log(`${safe(e.name)}@${safe(e.version ?? '?')}  ${safe(e.description ?? '')}${tags}`);
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
  const { positionals, flags } = parseArgs(args, FLAGS.hub as FlagSpec);
  const kind = positionals[0];
  const query = positionals.slice(1).join(' ');
  const indexes = jsonIndexUrls(flags);

  if (kind === 'mcp') {
    const { results, errors } = await searchMcpHubs(
      query,
      defaultMcpSources({ fetch, jsonIndexUrls: indexes }),
    );
    if (flags.json) {
      io.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      io.log(query ? `no MCP servers match "${query}"` : 'no results');
    } else {
      for (const r of results) {
        const pop = typeof r.popularity === 'number' ? `  (${r.popularity} uses)` : '';
        const creds =
          r.credentials.length > 0
            ? `  needs ${r.credentials.map((c) => safe(c.ref)).join(', ')}`
            : '';
        io.log(
          `${safe(r.entry.id)}  [${r.source}]  ${safe(r.entry.name)} — ${safe(r.entry.description)}${pop}${creds}`,
        );
      }
    }
    for (const e of errors) io.error(`  (hub ${e.source} unavailable: ${e.message})`);
    return 0;
  }

  if (kind === 'skills') {
    const { results, errors } = await searchSkillHubs(
      query,
      defaultSkillSources({
        fetch,
        jsonIndexUrls: indexes,
        githubToken: process.env.GITHUB_TOKEN,
      }),
    );
    if (flags.json) {
      io.log(JSON.stringify(results, null, 2));
    } else if (results.length === 0) {
      io.log(query ? `no skills match "${query}"` : 'no results');
    } else {
      for (const r of results) {
        const stars = typeof r.stars === 'number' ? `  ★${r.stars}` : '';
        io.log(`${safe(r.name)}  [${r.source}]${stars}  ${safe(r.description)}`);
        if (r.skillUrl) io.log(`    SKILL.md: ${safe(r.skillUrl)}`);
      }
    }
    for (const e of errors) io.error(`  (hub ${e.source} unavailable: ${e.message})`);
    return 0;
  }

  io.error(`usage: uniqent ${USAGE.hub}`);
  return 1;
}

/** Read a hex private key from a keyfile written by `keygen`; explains exactly what is wrong. */
async function loadPrivateKey(path: string): Promise<string> {
  const hint =
    'expected a JSON keyfile with a 64-hex-char "privateKey" (create one with: uniqent keygen)';
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    throw new Error(`cannot read key file ${path}: ${(e as Error).message}`, { cause: e });
  }
  let kp: unknown;
  try {
    kp = JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON; ${hint}`);
  }
  const privateKey = (kp as { privateKey?: unknown } | null)?.privateKey;
  if (typeof privateKey !== 'string' || !/^[0-9a-f]{64}$/i.test(privateKey))
    throw new Error(`${path} has no valid "privateKey"; ${hint}`);
  return privateKey;
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
    `signing with an ephemeral key (integrity only; fingerprint ${publicKeyFingerprint(kp.publicKey)}). Use --key <keyfile> for a stable publisher identity.`,
  );
  return signBundle(bundle, kp.privateKey);
}

async function keygen(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args, FLAGS.keygen as FlagSpec);
  const out = typeof flags.out === 'string' ? flags.out : 'uniqent.key.json';
  if (await pathExists(out)) {
    io.error(`keygen: ${out} already exists; pass -o <file> or remove it (do not overwrite a key)`);
    return 1;
  }
  const kp = await generateKeypair();
  // Private key: owner-only, and never clobber an existing file (wx).
  await writeFile(out, JSON.stringify(kp, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  io.log(`wrote ${out}`);
  io.log(`public key: ${kp.publicKey}`);
  io.log(
    `fingerprint: ${publicKeyFingerprint(kp.publicKey)} (share this so installers can check it)`,
  );
  io.log(
    `Keep ${out} secret and out of git (add it to .gitignore). Sign with: uniqent sign <file> --key ${out}`,
  );
  return 0;
}

async function signCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args, FLAGS.sign as FlagSpec);
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
    const bundle = await bundleFromFile(file);
    signed = await signBundle(bundle, await loadPrivateKey(flags.key));
  } catch (e) {
    io.error(`sign: ${(e as Error).message}`);
    return 1;
  }
  const out = typeof flags.out === 'string' ? flags.out : file;
  await writeFile(out, await packBundle(signed));
  const v = await verify(signed);
  io.log(
    `signed ${out} — signature ${v.valid ? 'valid ✓' : 'INVALID'} (key fingerprint ${v.publicKey ? publicKeyFingerprint(v.publicKey) : 'none'})`,
  );
  return 0;
}

async function pathExists(p: string): Promise<boolean> {
  return stat(p)
    .then(() => true)
    .catch(() => false);
}

/**
 * Framework detection from marker files, so `--from` is optional. `root` is the Claude Code
 * project, the Hermes home (config.yaml / SOUL.md) or the OpenClaw state dir (openclaw.json).
 */
async function detectExportTarget(root: string): Promise<string[]> {
  const hits: string[] = [];
  if ((await pathExists(join(root, '.claude'))) || (await pathExists(join(root, '.mcp.json'))))
    hits.push('claude-code');
  if ((await pathExists(join(root, 'config.yaml'))) || (await pathExists(join(root, 'SOUL.md'))))
    hits.push('hermes');
  if (await pathExists(join(root, 'openclaw.json'))) hits.push('openclaw');
  return hits;
}

async function exportCmd(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args, FLAGS.export as FlagSpec);
  const root = typeof flags.root === 'string' ? flags.root : process.cwd();
  const isDir = await stat(root)
    .then((st) => st.isDirectory())
    .catch(() => false);
  if (!isDir) {
    io.error(`export: --root ${root} is not an existing directory`);
    return 1;
  }

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
  if (hasNoComponents(m.components)) {
    io.error(
      `export: found nothing to capture from ${adapter.displayName} at ${root} (no persona, skills, MCP servers, memory, profile, tools, channels or tasks); check --root and --from`,
    );
    return 1;
  }
  io.log(`\nCaptured from ${adapter.displayName} at ${root}:`);
  io.log(
    `  identity=${m.components.identity} skills=${m.components.skills.length} mcp=${m.components.mcp.length} memory=${m.components.memory.facts} channels=${m.components.channels.length} tasks=${m.components.tasks.length}`,
  );
  if (m.credentials.length > 0)
    io.log(`  credentials to re-supply on install: ${m.credentials.map((c) => c.ref).join(', ')}`);

  const result = validateBundle(bundle);
  if (!result.ok) {
    io.error(`export: captured bundle is invalid: ${describeIssues(result.errors).join('; ')}`);
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
  const { positionals, flags } = parseArgs(args, FLAGS['import-vault'] as FlagSpec);
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
      `import-vault: produced an invalid bundle: ${describeIssues(valid.errors).join('; ')}`,
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
  const { positionals, flags } = parseArgs(args, FLAGS['publish-memory'] as FlagSpec);
  const file = positionals[0];
  if (!file) {
    io.error('publish-memory: missing <pack.json|notes.md>');
    return 1;
  }
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
  const token = await resolveToken({ flag: flags.token, registry });
  if (!token) {
    io.error('publish-memory: not logged in — run `uniqent login` (or pass --token <t>)');
    return 1;
  }

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
    const r = await publishMemoryPack(fetch, registry, token, pack, undefined);
    io.log(
      `published ${r.slug} (${r.factCount} fact(s))${r.url ? ` → ${r.url}` : ''}${r.persisted === false ? ' (stored, not indexed)' : ''}`,
    );
    return 0;
  } catch (e) {
    io.error(`publish-memory: ${(e as Error).message}`);
    return 1;
  }
}

/** Publish a packed .uniqent (or a dir, packed on the fly) to a hosted registry. */
async function publishCmd(args: string[], io: CliIo): Promise<number> {
  const { positionals, flags } = parseArgs(args, FLAGS['publish'] as FlagSpec);
  const target = positionals[0];
  if (!target) {
    io.error('publish: missing <file.uniqent|dir>');
    return 1;
  }
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
  const token = await resolveToken({ flag: flags.token, registry });
  if (!token) {
    io.error('publish: not logged in — run `uniqent login` (or pass --token <t>)');
    return 1;
  }

  let bytes: Uint8Array;
  try {
    const isDir = await stat(target)
      .then((s) => s.isDirectory())
      .catch(() => false);
    if (isDir) {
      const bundle = await maybeSign(await readDir(target), flags, io);
      bytes = await packBundle(bundle); // validates + secret-scans
    } else {
      bytes = new Uint8Array(await readFile(target));
    }
  } catch (e) {
    io.error(`publish: cannot read ${target}: ${(e as Error).message}`);
    return 1;
  }

  try {
    const r = await publishBundle(fetch, registry, token, bytes, undefined);
    io.log(
      `published ${r.name}@${r.version}${r.signed ? ' (signed)' : ''}${r.persisted === false ? ' (stored, not indexed)' : ''}${r.url ? ` → ${r.url}` : ''}`,
    );
    return 0;
  } catch (e) {
    const msg = (e as Error).message;
    if (/unauthorized/i.test(msg)) {
      io.error('publish: not logged in — run `uniqent login` (or pass --token <t>)');
    } else if (/owned by another publisher/i.test(msg)) {
      io.error(`publish: ${msg}`);
    } else if (/sign|unsigned|signature|secret|trust|verif/i.test(msg)) {
      io.error(`publish: ${msg} — pack and sign it: \`uniqent pack <dir> --sign\``);
    } else {
      io.error(`publish: ${msg}`);
    }
    return 1;
  }
}

async function loginCmd(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args, FLAGS.login as FlagSpec);
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;

  // Explicit paste/store path.
  if (typeof flags.token === 'string') {
    if (!flags.token) {
      io.error('login: empty --token');
      return 1;
    }
    await saveToken(registry, flags.token);
    io.log(`Saved token for ${registry}.`);
    return 0;
  }

  // Headless guard: no TTY means no browser to open.
  if (!process.stdout.isTTY) {
    io.error(
      `login: no browser available — pass --token <unq_live_…> (create one at ${registry}/account/tokens)`,
    );
    return 1;
  }

  // Default: browser device-authorization flow.
  const token = await runDeviceLogin({ registry, io });
  if (!token) return 1; // runDeviceLogin already printed the reason
  await saveToken(registry, token);
  io.log(`Logged in to ${registry}.`);
  return 0;
}

async function logoutCmd(args: string[], io: CliIo): Promise<number> {
  const { flags } = parseArgs(args, FLAGS.logout as FlagSpec);
  const registry = typeof flags.registry === 'string' ? flags.registry : DEFAULT_HUB;
  const had = await clearToken(registry);
  io.log(had ? `Logged out of ${registry}.` : `No token stored for ${registry}.`);
  return 0;
}

function splitCsv(s: string): string[] {
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

const COMMANDS: Record<string, (args: string[], io: CliIo) => Promise<number>> = {
  try: tryCmd,
  inspect,
  install,
  validate,
  pack,
  search,
  hub,
  export: exportCmd,
  'import-vault': importVaultCmd,
  publish: publishCmd,
  login: loginCmd,
  logout: logoutCmd,
  'publish-memory': publishMemoryCmd,
  keygen,
  sign: signCmd,
};

function printUsage(out: (m: string) => void): void {
  out(`usage: uniqent <${Object.keys(COMMANDS).join('|')}> [options]`);
  for (const name of Object.keys(COMMANDS)) out(`  ${USAGE[name]}`);
  out('  run `uniqent <command> --help` for one command; `uniqent --version` for the version');
}

async function cliVersion(): Promise<string> {
  // package.json sits one level above both src/ (tests) and dist/ (published).
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(await readFile(resolve(here, '..', 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof pkg.version !== 'string') throw new Error('@uniqent/cli package.json has no version');
  return pkg.version;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    printUsage(io.log);
    return 0;
  }
  if (cmd === '--version') {
    io.log(await cliVersion());
    return 0;
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    io.error(`unknown command "${cmd}"`);
    printUsage(io.error);
    return 1;
  }
  // `<cmd> --help` only prints usage: it must never write keys, clear tokens or open a browser.
  if (wantsHelp(rest)) {
    io.log(`usage: uniqent ${USAGE[cmd]}`);
    return 0;
  }
  try {
    return await handler(rest, io);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    io.error(`${cmd}: ${e.message}`);
    io.error(`usage: uniqent ${USAGE[cmd]}`);
    return 1;
  }
}
