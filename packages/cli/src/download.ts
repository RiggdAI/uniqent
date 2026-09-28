import { safe } from './display.js';

/** Per-attempt timeout for any bundle or registry download. */
export const FETCH_TIMEOUT_MS = 30_000;
/** Largest bundle/index the CLI will download (a .uniqent is normally a few hundred KB). */
export const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
/** Attempts per download; network errors and 5xx/429 are retried with a warning. */
const FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** A download failed: names the URL and, when the server answered, its status and body. */
export class DownloadError extends Error {
  constructor(
    readonly url: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

/** Parse a URL and require https (plain http is allowed only for loopback, for local dev). */
export function assertSecureUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DownloadError(raw, `invalid URL: ${raw}`);
  }
  if (url.protocol === 'https:') return url;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return url;
  throw new DownloadError(
    raw,
    `refusing insecure URL ${raw}: only https:// is allowed (http:// only for localhost/127.0.0.1)`,
  );
}

const isRetryableStatus = (status: number): boolean => status >= 500 || status === 429;

async function readCapped(res: Response, url: string, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > maxBytes)
    throw new DownloadError(url, `${url} is ${declared} bytes; the limit is ${maxBytes} bytes`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new DownloadError(url, `${url} exceeds the ${maxBytes}-byte download limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * Download `raw` (https, or http on loopback) with a timeout and size cap. Network errors and
 * 5xx/429 responses are retried with a warning; the last error is raised. 4xx fails at once.
 */
export async function download(raw: string, warn: (msg: string) => void): Promise<Uint8Array> {
  const url = assertSecureUrl(raw).toString();
  let last: Error = new DownloadError(url, `download of ${url} was not attempted`);
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    } catch (e) {
      const cause = (e as Error).cause;
      const reason =
        (e as Error).name === 'TimeoutError'
          ? `timed out after ${FETCH_TIMEOUT_MS}ms`
          : `${(e as Error).message}${cause instanceof Error ? ` (${cause.message})` : ''}`;
      last = new DownloadError(url, `fetch ${url} failed: ${reason}`);
    }
    if (res?.ok) return readCapped(res, url, MAX_DOWNLOAD_BYTES);
    if (res) {
      const body = safe((await res.text()).slice(0, 300));
      last = new DownloadError(
        url,
        `fetch ${url} failed: HTTP ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`,
        res.status,
      );
      if (!isRetryableStatus(res.status)) throw last;
    }
    if (attempt < FETCH_ATTEMPTS) {
      warn(`warning: ${last.message} (attempt ${attempt}/${FETCH_ATTEMPTS}, retrying)`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw last;
}
