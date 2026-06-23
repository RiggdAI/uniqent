import { spawn } from 'node:child_process';

export interface DeviceLoginDeps {
  registry: string;
  io: { log: (m: string) => void; error: (m: string) => void };
  fetchImpl?: typeof fetch;
  open?: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

interface StartResponse {
  device_code: string;
  user_code: string;
  verify_url: string;
  interval?: number;
  expires_in?: number;
}
interface PollResponse {
  status: 'pending' | 'approved' | 'expired';
  token?: string;
}

const base = (b: string) => b.replace(/\/+$/, '');

/** Open a URL in the OS browser. No-op when not a TTY (the URL was already printed). */
function defaultOpenUrl(url: string): void {
  if (!process.stdout.isTTY) return;
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* opening is best-effort; the URL is printed regardless */
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run the browser device-authorization flow. Returns the publish token, or null on failure/expiry/timeout. */
export async function runDeviceLogin(deps: DeviceLoginDeps): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const open = deps.open ?? defaultOpenUrl;
  const sleep = deps.sleep ?? defaultSleep;
  const b = base(deps.registry);

  const startRes = await fetchImpl(`${b}/api/v1/device/start`, { method: 'POST' });
  if (!startRes.ok) {
    deps.io.error(`login: device start failed (${startRes.status})`);
    return null;
  }
  const start = (await startRes.json()) as StartResponse;

  deps.io.log(
    `\nTo authorize this device, visit:\n  ${start.verify_url}\nand confirm the code:  ${start.user_code}\n`,
  );
  open(start.verify_url);

  const deadline = Date.now() + (start.expires_in ?? 600) * 1000;
  const intervalMs = (start.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const pollRes = await fetchImpl(`${b}/api/v1/device/poll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: start.device_code }),
    });
    const poll = (await pollRes.json()) as PollResponse;
    if (poll.status === 'approved' && poll.token) return poll.token;
    if (poll.status === 'expired') {
      deps.io.error('login: the code expired or was not approved.');
      return null;
    }
    // pending → keep polling
  }
  deps.io.error('login: timed out waiting for approval.');
  return null;
}
