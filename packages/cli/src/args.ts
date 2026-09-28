/** A command-line usage mistake (unknown flag, missing value, malformed --cred). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** The flags one command accepts. `--cred <ref>=<value>` is accepted when `cred` is true. */
export interface FlagSpec {
  boolean: string[];
  value: string[];
  cred: boolean;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
  creds: Record<string, string>;
}

/** Short aliases: `-o <file>` is `--out <file>`. */
const SHORT: Record<string, string> = { o: 'out' };

function splitCred(raw: string): [string, string] {
  const eq = raw.indexOf('=');
  if (eq <= 0) throw new UsageError(`--cred expects <ref>=<value>, got "${raw}"`);
  return [raw.slice(0, eq), raw.slice(eq + 1)];
}

/**
 * Parse argv for one command against its flag spec. Accepts `--flag value` and `--flag=value`;
 * throws UsageError on an unknown flag, a value flag without a value, or a value on a boolean.
 */
export function parseArgs(args: string[], spec: FlagSpec): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
  const creds: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    const isLong = a.startsWith('--') && a.length > 2;
    const isShort = /^-[a-zA-Z]$/.test(a) || /^-[a-zA-Z]=/.test(a);
    if (!isLong && !isShort) {
      positionals.push(a);
      continue;
    }
    const body = a.slice(isLong ? 2 : 1);
    const eq = body.indexOf('=');
    const rawName = eq === -1 ? body : body.slice(0, eq);
    const inline = eq === -1 ? undefined : body.slice(eq + 1);
    const name = isLong ? rawName : SHORT[rawName];
    if (name === undefined) throw new UsageError(`unknown flag ${a}`);
    const shown = isLong ? `--${name}` : `-${rawName}`;

    if (name === 'cred' && spec.cred) {
      const raw = inline ?? args[i + 1];
      if (raw === undefined || (inline === undefined && raw.startsWith('-')))
        throw new UsageError('--cred needs a value: --cred <ref>=<value>');
      if (inline === undefined) i++;
      const [ref, value] = splitCred(raw);
      creds[ref] = value;
    } else if (spec.boolean.includes(name)) {
      if (inline !== undefined) throw new UsageError(`${shown} does not take a value`);
      flags[name] = true;
    } else if (spec.value.includes(name)) {
      if (inline !== undefined) {
        flags[name] = inline;
      } else {
        const next = args[i + 1];
        if (next === undefined || next.startsWith('-'))
          throw new UsageError(`${shown} needs a value`);
        flags[name] = next;
        i++;
      }
    } else {
      throw new UsageError(`unknown flag ${shown}`);
    }
  }
  return { positionals, flags, creds };
}

/** True when the args ask for help (`--help` / `-h`); commands then print usage and do nothing. */
export function wantsHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}
