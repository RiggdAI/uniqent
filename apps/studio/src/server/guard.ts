const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Studio's API writes to the local filesystem, so it must only serve local requests.
 * Rejects a non-local Host header (DNS-rebinding) and any cross-origin browser request
 * (CSRF — a cross-origin POST still carries an Origin header, even for "simple" requests).
 */
export function isLocalApiRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const host = String(headers.host ?? '').split(':')[0] ?? '';
  if (!LOCAL_HOSTS.has(host)) return false;
  const origin = headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      if (!LOCAL_HOSTS.has(new URL(origin).hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
