/**
 * Browser-safe subset of @uniqent/core (no node:*, Buffer or process in its module graph).
 * Used by the native Studio web UI; the CLI keeps using the full `.` entry.
 */
export { Bundle, PATHS } from './bundle.js';
export * from './errors.js';
export * from './secret-scan.js';
export * from './validate.js';
export * from './secret-refs.js';
