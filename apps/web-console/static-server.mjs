// TEST/DEPLOY-ONLY static server for the built web-console SPA.
// Zero deps, zero filesystem writes (safe under readOnlyRootFilesystem),
// SPA fallback to index.html. Listens on :3000.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT = '/app/dist';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2', '.map':'application/json' };
http.createServer(async (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    const body = await readFile(join(ROOT, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  }
}).listen(3000, () => console.log('web-console static server on :3000'));
