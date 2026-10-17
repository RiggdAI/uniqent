import type { Bundle } from '@uniqent/core/pure';

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;
// C0/C1 control characters (incl. newlines, so a string can't forge extra output lines) and
// bidi overrides that can visually reorder text.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** Make an untrusted (bundle- or network-derived) string safe to print on one terminal line. */
export function safe(s: string): string {
  return s.replace(ANSI, '').replace(CONTROL, ' ');
}

/** Quote an argv element when needed so what runs is visible exactly (e.g. `bash -c "curl|sh"`). */
function shellWord(s: string): string {
  const clean = safe(s);
  return /^[\w@%+=:,./-]+$/.test(clean) ? clean : JSON.stringify(clean);
}

/**
 * One line per MCP server: exactly what command runs or which URL is contacted. Shown before an
 * install by the CLI and Studio; a bundle holds credential refs, never values.
 */
export function describeMcpServers(bundle: Bundle): string[] {
  return bundle.mcpServers().map((s) => {
    const auth = s.auth.credentialRef ? `  auth=${s.auth.type}:${safe(s.auth.credentialRef)}` : '';
    if (s.transport === 'stdio') {
      const argv = [s.command ?? '', ...(s.args ?? [])].map(shellWord).join(' ');
      const env = Object.entries(s.env ?? {})
        .map(([k, v]) => `${safe(k)}=${shellWord(v)}`)
        .join(' ');
      return `${safe(s.id)}  runs: ${argv}${env ? `  env: ${env}` : ''}${auth}`;
    }
    return `${safe(s.id)}  ${s.transport} ${safe(s.url ?? '')}${auth}`;
  });
}
