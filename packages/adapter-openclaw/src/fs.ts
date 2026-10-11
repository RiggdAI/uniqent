/** The error is a missing-file (ENOENT) error. */
export function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException).code === 'ENOENT';
}
