/**
 * Install the session's brain from the native app, in the CLI's `runInstall` order: validate the
 * draft (incl. the fail-closed secret scan) → read what the adapter asks for (Rust `read_inputs`)
 * → the adapter's pure plan/translate → hand the writes to Rust (`write_outputs`). Credential
 * values only pass through `translate` and the bytes given to Rust; nothing here logs.
 */
import { Bundle, validateBundle } from '@uniqent/core/pure';
import {
  displayPath,
  gatherInputs,
  joinPath,
  type InstallPlan,
  type InstallResult,
  type OutputWrite,
  type PureAdapter,
  type ReadFiles,
  type ReadFn,
  type ResolvedCredentials,
  type TargetContext,
  type Translation,
} from '@uniqent/adapter-sdk/pure';
import type { TargetId } from '@uniqent/builder/brain';
import { claudeCodePure } from '@uniqent/adapter-claude-code/pure';
import { hermesPure } from '@uniqent/adapter-hermes/pure';
import { openClawPure } from '@uniqent/adapter-openclaw/pure';
import { fromBase64, toBase64 } from './bytes';
import { call, frameworkHomes } from './native';

export const PURE_ADAPTERS: Record<TargetId, PureAdapter> = {
  'claude-code': claudeCodePure,
  hermes: hermesPure,
  openclaw: openClawPure,
};

/** One file across the IPC boundary (Rust `ReadFile` / `BundleFile`). */
interface IpcFile {
  path: string;
  bytesBase64: string;
}

const distinct = (roots: string[]): string[] => [...new Set(roots)];

/** ReadFn over Rust read_inputs, one call per distinct root. */
export const readViaRust: ReadFn = async (request) => {
  const read = new Map<string, Uint8Array>();
  const roots = distinct([...request.files, ...request.finds].map((r) => r.root));
  for (const root of roots) {
    const files = await call<IpcFile[]>('read_inputs', {
      root,
      files: request.files.filter((f) => f.root === root).map((f) => f.path),
      finds: request.finds
        .filter((f) => f.root === root)
        .map((f) => ({ dir: f.dir, fileName: f.fileName, skipDirs: f.skipDirs })),
    });
    for (const f of files) read.set(joinPath(root, f.path), fromBase64(f.bytesBase64));
  }
  return read;
};

/** Writing into `root` failed after earlier roots of the same install were written (paths only). */
export class PartialInstallError extends Error {
  constructor(
    readonly root: string,
    readonly writtenRoots: string[],
    cause: Error,
  ) {
    super(
      `writing into ${root} failed after ${writtenRoots.join(', ')} were already written: ${cause.message}`,
      { cause },
    );
    this.name = 'PartialInstallError';
  }
}

/** write_outputs per distinct root, in the translation's order. */
export async function writeViaRust(writes: OutputWrite[]): Promise<void> {
  const written: string[] = [];
  for (const root of distinct(writes.map((w) => w.root))) {
    try {
      await call<string[]>('write_outputs', {
        root,
        writes: writes
          .filter((w) => w.root === root)
          .map((w) => ({ path: w.path, bytesBase64: toBase64(w.bytes), mode: w.mode })),
      });
    } catch (e) {
      if (written.length === 0) throw e;
      throw new PartialInstallError(root, written, e as Error);
    }
    written.push(root);
  }
}

/** The session draft failed validateBundle; message `brain is invalid; fix it before installing: <issues>` (as the old server). */
export class BrainInvalidError extends Error {
  constructor(readonly issues: string[]) {
    super(`brain is invalid; fix it before installing: ${issues.join('; ')}`);
    this.name = 'BrainInvalidError';
  }
}

/** The session draft as a Bundle; throws BrainInvalidError (listing the issues) before any read. */
export async function sessionBundle(): Promise<Bundle> {
  const files = await call<IpcFile[]>('bundle_files');
  const bundle = Bundle.fromFiles(new Map(files.map((f) => [f.path, fromBase64(f.bytesBase64)])));
  const validation = validateBundle(bundle);
  if (!validation.ok) throw new BrainInvalidError(validation.errors.map((e) => e.message));
  return bundle;
}

/** The adapter context for `root`: `home` from Rust `framework_homes`, which also serves as `cwd`. */
export async function targetContext(root: string): Promise<TargetContext> {
  const { home } = await frameworkHomes();
  return { root, home, cwd: home };
}

interface Prepared {
  bundle: Bundle;
  pure: PureAdapter;
  ctx: TargetContext;
  read: ReadFiles;
}

/** The session bundle, the target context and everything the adapter asked to read. */
async function prepare(target: TargetId, root: string): Promise<Prepared> {
  const bundle = await sessionBundle();
  const pure = PURE_ADAPTERS[target];
  const ctx = await targetContext(root);
  const read = await gatherInputs((r, asked) => pure.inputs(bundle, r, ctx, asked), readViaRust);
  return { bundle, pure, ctx, read };
}

/** Credential-free dry run (writes + lossiness + required credentials). */
export async function planInstall(target: TargetId, root: string): Promise<InstallPlan> {
  const { bundle, pure, ctx, read } = await prepare(target, root);
  return pure.plan(bundle, read, ctx);
}

/**
 * Read + pure translate with the typed credentials, writing nothing: its `notes` include what only
 * the credentials reveal (e.g. "replaces your existing, different value of X" in .env), shown
 * before the user confirms.
 */
export async function previewInstall(
  target: TargetId,
  root: string,
  resolved: ResolvedCredentials,
): Promise<Translation> {
  const { bundle, pure, ctx, read } = await prepare(target, root);
  return pure.translate(bundle, read, resolved, ctx);
}

/**
 * What the user reviewed, without the bytes (they can hold credential values): each write's
 * location, mode and SHA-256, in write order, and every note.
 */
export interface ReviewedInstall {
  writes: Array<{ root: string; path: string; mode: OutputWrite['mode']; sha256: string }>;
  notes: string[];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A translation's reviewable fingerprint (see ReviewedInstall). */
export async function reviewOf(t: Translation): Promise<ReviewedInstall> {
  const writes = await Promise.all(
    t.writes.map(async (w) => ({
      root: w.root,
      path: w.path,
      mode: w.mode,
      sha256: await sha256Hex(w.bytes),
    })),
  );
  return { writes, notes: [...t.notes] };
}

/** The install would differ from what the user reviewed (the draft or the target files changed). */
export class ReviewOutdatedError extends Error {
  constructor() {
    super('The brain or the target files changed since you reviewed; review the changes again');
    this.name = 'ReviewOutdatedError';
  }
}

/**
 * Re-read, re-translate (validates before the first write) and hand the writes to Rust — only
 * when the result is exactly what was reviewed (else ReviewOutdatedError, nothing written).
 */
export async function applyInstall(
  target: TargetId,
  root: string,
  resolved: ResolvedCredentials,
  reviewed: ReviewedInstall,
): Promise<InstallResult> {
  const { bundle, pure, ctx, read } = await prepare(target, root);
  const t = pure.translate(bundle, read, resolved, ctx);
  if (JSON.stringify(await reviewOf(t)) !== JSON.stringify(reviewed))
    throw new ReviewOutdatedError();
  await writeViaRust(t.writes);
  return { written: t.writes.map((w) => displayPath(ctx.root, w)), notes: t.notes };
}
