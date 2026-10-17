const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Studio's API writes to the local filesystem, so it must only serve Studio's own page.
 * The Host header must name this server exactly (`<local host>:<port>`, blocks DNS-rebinding),
 * and a browser Origin, when sent, must be Studio's own origin including the port — a page on
 * any other local port is a different origin and must not drive the API (CSRF).
 */
export function isLocalApiRequest(
  headers: Record<string, string | string[] | undefined>,
  port: number,
): boolean {
  const allowedHosts = new Set(LOCAL_HOSTS.map((h) => `${h}:${port}`));
  if (typeof headers.host !== 'string' || !allowedHosts.has(headers.host)) return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  if (typeof origin !== 'string') return false;
  return LOCAL_HOSTS.some((h) => origin === `http://${h}:${port}`);
}

/**
 * Mutating API requests must declare `Content-Type: application/json`. Browsers only send that
 * cross-origin after a CORS preflight, which this server never approves, so a foreign page cannot
 * smuggle a "simple" text/plain or form POST past the Origin check's blind spots.
 */
export function hasJsonContentType(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const type = headers['content-type'];
  if (typeof type !== 'string') return false;
  return type.split(';')[0]?.trim().toLowerCase() === 'application/json';
}
