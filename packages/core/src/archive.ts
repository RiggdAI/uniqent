import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdir, readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { pack as tarPack, extract as tarExtract } from 'tar-stream';
import { Bundle, PATHS } from './bundle.js';
import { assertValid } from './validate.js';
import { scanForSecrets } from './secret-scan.js';
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
  tar.on('data', (c: Buffer) => chunks.push(c));
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

export async function unpack(input: Uint8Array): Promise<Bundle> {
  const tarBytes = gunzipSync(Buffer.from(input));
  const files = new Map<string, Uint8Array>();
  const extract = tarExtract();

  const done = new Promise<void>((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      const parts: Buffer[] = [];
      stream.on('data', (c: Buffer) => parts.push(c));
      stream.on('end', () => {
        if (header.type === 'file') files.set(header.name, new Uint8Array(Buffer.concat(parts)));
        next();
      });
      stream.on('error', reject);
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
      const s = await stat(full);
      if (s.isDirectory()) {
        await walk(full);
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
