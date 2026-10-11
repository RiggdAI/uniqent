import type { Dirent } from 'node:fs';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { Bundle } from '@uniqent/core';
import { scrubPrivateMemory } from '@uniqent/builder/brain';
import { gatherInputs, OWNER_ONLY } from './io.js';
import type { FindRef, OutputWrite, PureAdapter, ReadFn, TargetContext } from './io.js';
import { displayPath, joinPath } from './pure-paths.js';
import type { Adapter } from './types.js';

const isErrno = (err: unknown, code: string): boolean =>
  err instanceof Error && (err as NodeJS.ErrnoException).code === code;

/** Bytes of `abs`, or undefined if it does not exist (any other error is rethrown). */
async function readOptional(abs: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(abs);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return undefined;
    throw err;
  }
}

/** Every `find.fileName` under `dir`, keyed by absolute path; Dirents never follow symlinks. */
async function walk(dir: string, find: FindRef, out: Map<string, Uint8Array>): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isErrno(err, 'ENOENT')) return;
    throw err;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = joinPath(dir, e.name);
    if (e.isDirectory()) {
      if (!find.skipDirs.includes(e.name)) await walk(abs, find, out);
    } else if (e.isFile() && e.name === find.fileName) out.set(abs, await readFile(abs));
  }
}

/** Read an adapter's requested files and finds from the local filesystem. */
export const readFromDisk: ReadFn = async (request) => {
  const out = new Map<string, Uint8Array>();
  for (const f of request.files) {
    const abs = joinPath(f.root, f.path);
    const bytes = await readOptional(abs);
    if (bytes !== undefined) out.set(abs, bytes);
  }
  for (const f of request.finds) await walk(joinPath(f.root, f.dir), f, out);
  return out;
};

/**
 * Write a translation's files in order (plain writes, creating parent dirs). Owner-only files
 * are created 0600, and chmod also tightens a pre-existing file; others keep an existing mode.
 */
export async function writeToDisk(writes: OutputWrite[]): Promise<void> {
  for (const w of writes) {
    const target = joinPath(w.root, w.path);
    await mkdir(dirname(target), { recursive: true });
    if (w.mode === OWNER_ONLY) {
      await writeFile(target, w.bytes, { mode: OWNER_ONLY });
      await chmod(target, OWNER_ONLY);
    } else await writeFile(target, w.bytes);
  }
}

/** The CLI's target context: the resolved `root`, the user's home and the process cwd. */
export function nodeContext(root: string): TargetContext {
  return { root: resolve(root), home: homedir(), cwd: process.cwd() };
}

/**
 * Wrap a pure adapter as a Node `Adapter`: read inputs from disk → pure plan/translate/capture →
 * write. `export()` = pure capture → scrubPrivateMemory (the CLI never exports episodic/personal memory).
 */
export function nodeAdapter(pure: PureAdapter, detect: Adapter['detect']): Adapter {
  const gather = (bundle: Bundle, ctx: TargetContext) =>
    gatherInputs((read) => pure.inputs(bundle, read, ctx), readFromDisk);
  return {
    id: pure.id,
    displayName: pure.displayName,
    detect,
    async plan(bundle, { root }) {
      const ctx = nodeContext(root);
      return pure.plan(bundle, await gather(bundle, ctx), ctx);
    },
    async apply(bundle, _plan, resolved, { root }) {
      // Re-read and re-translate against the current disk state (validates before the first write).
      const ctx = nodeContext(root);
      const t = pure.translate(bundle, await gather(bundle, ctx), resolved, ctx);
      await writeToDisk(t.writes);
      return { written: t.writes.map((w) => displayPath(ctx.root, w)), notes: t.notes };
    },
    async export({ root }) {
      const ctx = nodeContext(root);
      const read = await gatherInputs((r) => pure.captureInputs(r, ctx), readFromDisk);
      // Pure capture keeps every memory item it finds; the export never carries private ones.
      return scrubPrivateMemory(pure.capture(read, ctx)).bundle;
    },
  };
}
