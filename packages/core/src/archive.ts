import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { pack as tarPack, extract as tarExtract, type Header } from 'tar-stream';
import { Bundle, PATHS, assertBundlePath } from './bundle.js';
import { assertValid } from './validate.js';
import { scanForSecrets } from './secret-scan.js';

/** tar-stream types stream chunks as unknown; they are Buffers at runtime — assert, don't cast. */
function asChunk(c: unknown): Buffer {
  if (!Buffer.isBuffer(c))
    throw new TypeError(`tar stream emitted a non-Buffer chunk: ${typeof c}`);
  return c;
}
import { SecretScanError, BundleFormatError } from './errors.js';

export interface PackOptions {
  skipValidation?: boolean;
}

/** Validate (unless skipped) + secret-scan gate, then tar+gzip to bytes. */
export async function pack(bundle: Bundle, opts: PackOptions = {}): Promise<Uint8Array> {
  const findings = scanForSecrets(bundle);
  if (findings.length) throw new SecretScanError(findings);
  if (!opts.skipValidation) assertValid(bundle);

  const tar = tarPack();
  const chunks: Buffer[] = [];
  tar.on('data', (c) => chunks.push(asChunk(c)));
  const done = new Promise<void>((resolve, reject) => {
    tar.on('end', resolve);
    tar.on('error', reject);
  });

  const sorted = bundle.entries().sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  await new Promise<void>((resolve, reject) => {
    let i = 0;
    const next = (): void => {
      if (i >= sorted.length) {
        tar.finalize();
        resolve();
        return;
      }
      const entry = sorted[i++];
      if (!entry) {
        tar.finalize();
        resolve();
        return;
      }
      const [path, bytes] = entry;
      tar.entry(
        { name: path, size: bytes.length, mtime: new Date(0), mode: 0o644 },
        Buffer.from(bytes),
        (err) => (err ? reject(err) : next()),
      );
    };
    next();
  });
  await done;

  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

/** Upper bound on the uncompressed tar size accepted by unpack (gzip-bomb guard). */
export const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
/** Upper bound on the number of tar entries accepted by unpack. */
export const MAX_ARCHIVE_ENTRIES = 10_000;

function gunzipBounded(input: Uint8Array): Buffer {
  try {
    return gunzipSync(Buffer.from(input), { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new BundleFormatError(
        `archive expands beyond ${MAX_UNPACKED_BYTES} bytes uncompressed (MAX_UNPACKED_BYTES); refusing to unpack`,
      );
    }
    throw e;
  }
}

/** Throw BundleFormatError unless the entry is a new regular file (or a directory) at a safe path. */
function assertArchiveEntry(
  header: Header,
  entryNumber: number,
  seen: ReadonlyMap<string, Uint8Array>,
): void {
  if (entryNumber > MAX_ARCHIVE_ENTRIES) {
    throw new BundleFormatError(
      `archive has more than ${MAX_ARCHIVE_ENTRIES} entries (MAX_ARCHIVE_ENTRIES)`,
    );
  }
  if (header.type === 'directory') {
    assertBundlePath(header.name.replace(/\/$/, ''));
    return;
  }
  if (header.type !== 'file') {
    throw new BundleFormatError(
      `archive entry ${JSON.stringify(header.name)} has unsupported type "${header.type}" (only regular files and directories are allowed)`,
    );
  }
  assertBundlePath(header.name);
  if (seen.has(header.name)) {
    throw new BundleFormatError(`archive has duplicate entry ${JSON.stringify(header.name)}`);
  }
}

/**
 * Read a .uniqent archive. Fails closed on anything that is not a plain, uniquely named file with a
 * safe relative path (see assertBundlePath): links and special entries, duplicates, oversized or
 * over-populated archives are all malformed bundles. Directory entries are validated and ignored.
 */
export async function unpack(input: Uint8Array): Promise<Bundle> {
  const tarBytes = gunzipBounded(input);
  const files = new Map<string, Uint8Array>();
  const extract = tarExtract();
  let entryCount = 0;

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      stream.on('error', reject);
      entryCount += 1;
      try {
        assertArchiveEntry(header, entryCount, files);
      } catch (e) {
        extract.destroy(e as Error);
        return;
      }
      if (header.type === 'directory') {
        stream.on('end', next);
        stream.resume();
        return;
      }
      const parts: Buffer[] = [];
      stream.on('data', (c) => parts.push(asChunk(c)));
      stream.on('end', () => {
        files.set(header.name, new Uint8Array(Buffer.concat(parts)));
        next();
      });
    });
    extract.on('finish', resolve);
    extract.on('error', reject);
  });

  extract.end(tarBytes);
  await done;

  if (!files.has(PATHS.manifest)) {
    throw new BundleFormatError('archive does not contain uniqent.json');
  }
  return Bundle.fromFiles(files);
}

export async function writeDir(bundle: Bundle, dir: string): Promise<void> {
  for (const [path, bytes] of bundle.entries()) {
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

export async function readDir(dir: string): Promise<Bundle> {
  const files = new Map<string, Uint8Array>();
  async function walk(current: string): Promise<void> {
    for (const name of await readdir(current)) {
      const full = join(current, name);
      const s = await lstat(full);
      if (s.isDirectory()) {
        await walk(full);
      } else if (!s.isFile()) {
        throw new BundleFormatError(
          `${full} is not a regular file or directory (symlinks and special files are not allowed in a bundle)`,
        );
      } else {
        const rel = relative(dir, full).split(sep).join('/');
        files.set(rel, new Uint8Array(await readFile(full)));
      }
    }
  }
  await walk(dir);
  if (!files.has(PATHS.manifest)) {
    throw new BundleFormatError(`${dir} does not contain uniqent.json`);
  }
  return Bundle.fromFiles(files);
}
