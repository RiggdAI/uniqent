/** Per-request deadline for every hub call, so one hanging hub can't stall a fan-out search. */
export const HUB_REQUEST_TIMEOUT_MS = 10_000;
/** Total attempts per hub request (1 try + retries) for network errors, timeouts, and 5xx. */
export const HUB_REQUEST_ATTEMPTS = 2;
/** Pause between attempts. */
export const HUB_RETRY_DELAY_MS = 500;
/** How much of an error response body to quote in the thrown message. */
const BODY_SNIPPET_CHARS = 300;

/** The fetch function a caller supplies: Node's global fetch, or Tauri's plugin-http fetch. */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

/** A hub answered with a non-success status. Carries the status and a body snippet. */
export class HubHttpError extends Error {
  constructor(
    readonly source: string,
    readonly url: string,
    readonly status: number,
    readonly bodySnippet: string,
    hint: string,
  ) {
    super(`${source}: ${status} from ${url}${hint ? ` — ${hint}` : ''}: ${bodySnippet}`);
    this.name = 'HubHttpError';
  }
}

/** Read up to BODY_SNIPPET_CHARS of a response body for an error message. */
export async function bodySnippet(res: Response): Promise<string> {
  const text = await res.text();
  return text.length > BODY_SNIPPET_CHARS ? `${text.slice(0, BODY_SNIPPET_CHARS)}…` : text;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * GET a hub URL with a per-request timeout (HUB_REQUEST_TIMEOUT_MS) and retries on network
 * errors, timeouts, and 5xx (warning on each retry, then throwing the last error). Responses
 * below 500 are returned as-is so callers can handle 404/403 themselves. A caller abort is
 * never retried.
 */
export async function hubFetch(
  fetchFn: FetchFn,
  source: string,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<Response> {
  let lastError: Error = new Error(`${source}: no attempt made for ${url}`);
  for (let attempt = 1; attempt <= HUB_REQUEST_ATTEMPTS; attempt++) {
    const timeout = AbortSignal.timeout(HUB_REQUEST_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const res = await fetchFn(url, { headers, signal: combined });
      if (res.status < 500) return res;
      lastError = new HubHttpError(source, url, res.status, await bodySnippet(res), '');
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = timeout.aborted
        ? new Error(`${source}: request to ${url} timed out after ${HUB_REQUEST_TIMEOUT_MS}ms`)
        : new Error(`${source}: request to ${url} failed: ${describe(err)}`, { cause: err });
    }
    if (attempt < HUB_REQUEST_ATTEMPTS) {
      console.warn('hub request failed; retrying', {
        source,
        url,
        attempt,
        maxAttempts: HUB_REQUEST_ATTEMPTS,
        error: lastError.message,
      });
      await new Promise((r) => setTimeout(r, HUB_RETRY_DELAY_MS));
    }
  }
  throw lastError;
}

/** hubFetch + require a 2xx + parse JSON. Throws HubHttpError (status + body) otherwise. */
export async function hubFetchJson(
  fetchFn: FetchFn,
  source: string,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const res = await hubFetch(fetchFn, source, url, headers, signal);
  if (!res.ok) throw new HubHttpError(source, url, res.status, await bodySnippet(res), '');
  return res.json();
}
