import { readFile, stat } from 'node:fs/promises';

const isNotFound = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && err.code === 'ENOENT';

/** Read a UTF-8 file; undefined only when it does not exist (any other error is rethrown). */
export async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

/** Whether a path exists; any error other than "not found" is rethrown. */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}
