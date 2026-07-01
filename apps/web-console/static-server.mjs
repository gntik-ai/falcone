// TEST/DEPLOY-ONLY static server for the built web-console SPA.
// Zero deps, zero filesystem writes (safe under readOnlyRootFilesystem),
// SPA fallback to index.html. Listens on :3000.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip } from 'node:zlib';

const ROOT = process.env.WEB_CONSOLE_STATIC_ROOT || '/app/dist';
const configuredPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const PORT = Number.isFinite(configuredPort) ? configuredPort : 3000;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2', '.map':'application/json' };
const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.svg', '.map']);
const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

function headerString(value) {
  return Array.isArray(value) ? value.join(',') : (value ?? '');
}

function acceptsEncoding(header, encoding) {
  return headerString(header).split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';').map((value) => value.trim());
    if (name !== encoding) return false;
    const q = params.find((param) => param.startsWith('q='));
    if (!q) return true;
    const qValue = Number.parseFloat(q.slice(2));
    return Number.isNaN(qValue) || qValue > 0;
  });
}

function chooseCompression(req, filePath) {
  if (!COMPRESSIBLE.has(extname(filePath))) return null;
  const acceptEncoding = req.headers['accept-encoding'];
  if (acceptsEncoding(acceptEncoding, 'br')) return 'br';
  if (acceptsEncoding(acceptEncoding, 'gzip')) return 'gzip';
  return null;
}

function cacheControl(filePath) {
  if (filePath === '/index.html') return 'no-store';
  if (filePath.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return null;
}

async function sendStatic(req, res, filePath, body, contentType) {
  const headers = { 'content-type': contentType };
  const cache = cacheControl(filePath);
  if (cache) headers['cache-control'] = cache;
  if (COMPRESSIBLE.has(extname(filePath))) headers.vary = 'Accept-Encoding';

  const encoding = chooseCompression(req, filePath);
  if (encoding === 'br') {
    body = await brotliAsync(body);
    headers['content-encoding'] = 'br';
  } else if (encoding === 'gzip') {
    body = await gzipAsync(body);
    headers['content-encoding'] = 'gzip';
  }

  res.writeHead(200, headers);
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  let p = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, p));
    await sendStatic(req, res, p, body, MIME[extname(p)] ?? 'application/octet-stream');
  } catch {
    const body = await readFile(join(ROOT, 'index.html'));
    await sendStatic(req, res, '/index.html', body, 'text/html');
  }
});

server.listen(PORT, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`web-console static server on :${actualPort}`);
});
