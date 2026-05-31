import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StudioSession } from './session.js';
import { handleApi } from './api.js';

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
        let body: unknown = {};
        if (method !== 'GET') {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const raw = Buffer.concat(chunks).toString('utf8');
          body = raw ? JSON.parse(raw) : {};
        }
        const { status, json } = await handleApi(session, method, url.pathname, body);
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

server.listen(PORT, () => {
  console.log(`Uniqent Studio running at http://localhost:${PORT}`);
});
