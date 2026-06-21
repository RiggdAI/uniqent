/**
 * Publish a packed .uniqent bundle to a hosted registry's `POST /api/v1/bundles`
 * (bearer-token gated). `registry` is the SITE base (e.g. https://uniqent.ai), not an
 * index.json URL. The server runs its trust gate (validate + secret-scan + verify) and
 * records ownership. Throws with the server's message on failure.
 */
const base = (b: string) => b.replace(/\/+$/, '');

export interface BundlePublishResult {
  ok: boolean;
  name: string;
  version: string;
  url?: string;
  signed?: boolean;
  persisted?: boolean;
}

export async function publishBundle(
  registry: string,
  token: string,
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<BundlePublishResult> {
  if (!token) throw new Error('a publish token is required');
  const res = await fetch(`${base(registry)}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: bytes,
    ...(signal ? { signal } : {}),
  });
  const json = (await res.json().catch(() => ({}))) as Partial<BundlePublishResult> & { error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
  return {
    ok: json.ok ?? true,
    name: json.name ?? '',
    version: json.version ?? '',
    url: json.url,
    signed: json.signed,
    persisted: json.persisted,
  };
}
