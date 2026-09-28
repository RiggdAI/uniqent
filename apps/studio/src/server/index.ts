import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioSession } from './session.js';
import { handleRawApi } from './api.js';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../../dist-web');
const PORT = Number(process.env.UNIQENT_STUDIO_PORT ?? 4173);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const rel = normalize(pathname)
    .replace(/^(\.\.[/\\])+/, '')
    .replace(/^\/+/, '');
  const candidate = rel === '' ? 'index.html' : rel;
  for (const target of [join(webRoot, candidate), join(webRoot, 'index.html')]) {
    try {
      const data = await readFile(target);
      res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
      res.end(data);
      return;
    } catch {
      // try next (SPA fallback to index.html)
    }
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found (did you run `pnpm --filter @uniqent/studio build`?)');
}

const session = new StudioSession();

const server = createServer((req, res) => {
  void (async () => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');

    if (url.pathname.startsWith('/api')) {
      try {
        const chunks: Buffer[] = [];
        if (method !== 'GET') for await (const c of req) chunks.push(c as Buffer);
        const { status, json } = await handleRawApi(
          session,
          {
            method,
            path: url.pathname,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          },
          PORT,
        );
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
      return;
    }

    await serveStatic(url.pathname, res);
  })();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Uniqent Studio running at http://localhost:${PORT}`);
});
