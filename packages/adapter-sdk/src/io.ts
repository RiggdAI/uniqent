import type { Bundle } from '@uniqent/core/pure';
import { joinPath } from './pure-paths.js';
import type { InstallPlan, ResolvedCredentials } from './types.js';

/** A file location: an absolute base directory and a POSIX path relative to it. */
export interface FileRef {
  root: string;
  path: string;
}

/** Every file named `fileName` under `root/dir` at any depth; dot dirs and `skipDirs` are skipped, symlinks never followed. */
export interface FindRef {
  root: string;
  dir: string;
  fileName: string;
  skipDirs: string[];
}

export interface InputRequest {
  files: FileRef[];
  finds: FindRef[];
}

/** Bytes read so far, keyed by `joinPath(root, path)`. A requested file that does not exist is absent. */
export type ReadFiles = ReadonlyMap<string, Uint8Array>;
export type ReadFn = (request: InputRequest) => Promise<ReadFiles>;

/** Mode for files holding resolved secrets. `null` keeps an existing file's mode (new files: 0666 & ~umask). */
export const OWNER_ONLY = 0o600;

export interface OutputWrite extends FileRef {
  bytes: Uint8Array;
  mode: typeof OWNER_ONLY | null;
}

/** Absolute paths an adapter resolves against. `home` expands `~`; `cwd` resolves relative config paths. */
export interface TargetContext {
  root: string;
  home: string;
  cwd: string;
}

export interface Translation {
  plan: InstallPlan;
  /** In write order; the CLI prints them in this order. */
  writes: OutputWrite[];
  /** Exactly the `InstallResult.notes` apply() returns today. */
  notes: string[];
}

/** One framework target's pure logic, shared verbatim by the CLI (Node) and Studio (webview). */
export interface PureAdapter {
  id: string;
  displayName: string;
  inputs(bundle: Bundle, read: ReadFiles, ctx: TargetContext): InputRequest;
  plan(bundle: Bundle, read: ReadFiles, ctx: TargetContext): InstallPlan;
  translate(
    bundle: Bundle,
    read: ReadFiles,
    resolved: ResolvedCredentials,
    ctx: TargetContext,
  ): Translation;
  captureInputs(read: ReadFiles, ctx: TargetContext): InputRequest;
  capture(read: ReadFiles, ctx: TargetContext): Bundle;
}

/** The adapter kept asking for new files (OpenClaw needs 2 rounds: openclaw.json, then its workspace). */
export class InputsUnsettledError extends Error {
  constructor(readonly rounds: number) {
    super(`adapter inputs did not settle after ${rounds} read rounds`);
    this.name = 'InputsUnsettledError';
  }
}

const MAX_ROUNDS = 4;
const fileKey = (f: FileRef) => joinPath(f.root, f.path);
const findKey = (f: FindRef) =>
  `find:${joinPath(f.root, f.dir)}:${f.fileName}:${f.skipDirs.join(',')}`;

/**
 * Read what `next` asks for until it asks for nothing new (each file/find is read once), so an
 * adapter can request files whose location depends on files already read.
 */
export async function gatherInputs(
  next: (read: ReadFiles) => InputRequest,
  readFn: ReadFn,
): Promise<ReadFiles> {
  const read = new Map<string, Uint8Array>();
  const asked = new Set<string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const req = next(read);
    const files = req.files.filter((f) => !asked.has(fileKey(f)));
    const finds = req.finds.filter((f) => !asked.has(findKey(f)));
    if (files.length === 0 && finds.length === 0) return read;
    files.forEach((f) => asked.add(fileKey(f)));
    finds.forEach((f) => asked.add(findKey(f)));
    for (const [k, v] of await readFn({ files, finds })) read.set(k, v);
  }
  throw new InputsUnsettledError(MAX_ROUNDS);
}

// Non-fatal (invalid bytes → U+FFFD) and BOM-preserving, like Node's `readFile(…, 'utf8')`.
const UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** UTF-8 text of `root/path` (Node `readFile(…, 'utf8')` semantics: invalid bytes → U+FFFD), or undefined if absent. */
export function readText(read: ReadFiles, root: string, path: string): string | undefined {
  const bytes = read.get(joinPath(root, path));
  return bytes === undefined ? undefined : UTF8.decode(bytes);
}

/** Byte-for-byte equality without `Buffer`: every adapter's "replaces an existing, different file" check. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
