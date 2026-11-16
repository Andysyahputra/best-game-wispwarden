// Wispwarden local static server: serves only regular files beneath game/.
// Binds to 127.0.0.1, default port 4173. Normalizes URL paths, ignores query
// strings for lookup, rejects traversal, and never exposes the repository root.

import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const gameDir = resolve(join(repoRoot, 'game'));
const port = Number(process.env.PORT || 4173);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  try {
    const raw = decodeURIComponent(new URL(req.url || '/', 'http://127.0.0.1').pathname);
    let rel = normalize(raw).replace(/^[/\\]+/, '');
    if (rel === '' || rel === '.') rel = 'index.html';
    const full = resolve(gameDir, rel);
    if (full !== gameDir && !full.startsWith(gameDir + sep)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    const st = statSync(full);
    if (!st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(readFileSync(full));
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving game/ at http://127.0.0.1:${port}/`);
});
