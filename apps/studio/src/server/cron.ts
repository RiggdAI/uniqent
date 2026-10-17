/** The five standard cron fields, in order, with their inclusive numeric bounds. */
const CRON_FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 7 },
] as const;

/** One list item of a cron field: `*`, `N` or `N-M`, optionally followed by `/step`. */
const CRON_ITEM = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/;

/**
 * Explain why `expr` is not a standard 5-field cron expression (numeric values, ranges, lists,
 * steps and `*`), or return undefined when it is valid. Kept in lockstep with the Rust
 * `cron_problem` in src-tauri/src/session.rs.
 */
export function cronProblem(expr: string): string | undefined {
  const parts = expr.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== CRON_FIELDS.length) {
    return `expected 5 space-separated fields (minute hour day-of-month month day-of-week), got ${parts.length}`;
  }
  for (const [i, field] of CRON_FIELDS.entries()) {
    const value = parts[i] ?? '';
    for (const item of value.split(',')) {
      const m = CRON_ITEM.exec(item);
      if (!m)
        return `${field.name} field "${value}" must be *, a number, a range, a list or a step`;
      const [, lo, hi, step] = m;
      for (const n of [lo, hi]) {
        if (n !== undefined && (Number(n) < field.min || Number(n) > field.max)) {
          return `${field.name} value ${n} is out of range ${field.min}-${field.max}`;
        }
      }
      if (lo !== undefined && hi !== undefined && Number(lo) > Number(hi)) {
        return `${field.name} range "${item}" runs backwards`;
      }
      if (step !== undefined && Number(step) === 0) return `${field.name} step must be at least 1`;
    }
  }
  return undefined;
}
