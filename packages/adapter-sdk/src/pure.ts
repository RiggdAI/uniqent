/**
 * Browser-safe subset of @uniqent/adapter-sdk (no node:*, Buffer or process in its module graph):
 * the pure adapter contract, POSIX path confinement and the credential checks. Used by the pure
 * adapters in the native Studio web UI; the CLI wraps them with `nodeAdapter` from the `.` entry.
 */
export * from './types.js';
export * from './io.js';
export * from './pure-paths.js';
export * from './credentials.js';
