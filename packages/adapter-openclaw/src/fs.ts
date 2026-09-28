import { readFile } from 'node:fs/promises';

/** The error is a missing-file (ENOENT) error. */
export function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}

/** Read a UTF-8 file, or undefined when it does not exist; any other error is raised. */
export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

/** Read raw bytes, or undefined when the file does not exist; any other error is raised. */
export async function readOptionalBytes(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}
