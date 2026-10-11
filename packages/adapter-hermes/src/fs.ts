import { stat } from 'node:fs/promises';

const isNotFound = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && err.code === 'ENOENT';

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
