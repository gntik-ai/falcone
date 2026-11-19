// TEST/DEPLOY-ONLY static server for the built web-console SPA.
// Zero deps, zero filesystem writes (safe under readOnlyRootFilesystem),
// SPA fallback to index.html. Listens on :3000.
//
// The bundle served at / is the web-console-next build (basename /). The former /next prefix
// answers a permanent redirect to the same path at the root; no path serves the legacy bundle.
//
// Same-origin API edge (fix-console-edge-routing, #505): the SPA issues relative /v1/* API calls;
// without an edge the SPA fallback below returned index.html (HTML) for every API request. We
// reverse-proxy /v1/* to the gateway (APISIX → control-plane; GATEWAY_UPSTREAM, default
// falcone-apisix:9080), preserving method/headers/body so the browser reaches the backend.
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
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "form-action 'self'"
].join('; ');
const SECURITY_HEADERS = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
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
  const headers = { ...SECURITY_HEADERS, 'content-type': contentType };
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

// Match a path prefix on the RAW request target. A percent-encoded unreserved character is equivalent to
// its literal (RFC 3986 section 6.2.2.2), so /%6Eext is /next; reserved escapes such as %2F never are.
// Returns the raw remainder after the prefix (byte for byte), or null when the prefix does not match
// or is not followed by '/' or the end of the path.
function rawRemainder(rawPath, prefix) {
  let index = 0;
  for (const char of prefix) {
    if (rawPath[index] === char) index += 1;
    else if (rawPath[index] === '%' && UNRESERVED.test(char) && rawPath.slice(index + 1, index + 3).toLowerCase() === char.charCodeAt(0).toString(16).padStart(2, '0')) index += 3;
    else return null;
  }
  const rest = rawPath.slice(index);
  return rest === '' || rest.startsWith('/') ? rest : null;
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'text/plain', ...extraHeaders });
  res.end(text);
}

const [GW_HOST, GW_PORT = '9080'] = (process.env.GATEWAY_UPSTREAM ?? 'falcone-apisix:9080').split(':');
const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  // Proxy the same-origin API surface to the gateway (must precede the SPA fallback).
  if (req.url === '/v1' || req.url?.startsWith('/v1/')) {
    const upstream = http.request(
      { host: GW_HOST, port: Number(GW_PORT) || 9080, method: req.method, path: req.url, headers: { ...req.headers, host: `${GW_HOST}:${GW_PORT}` } },
      (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); }
    );
    upstream.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'GATEWAY_UNREACHABLE', message: String(e.message) }));
    });
    req.pipe(upstream);
    return;
  }
  const target = req.url ?? '/';
  const queryAt = target.indexOf('?');
  const rawPath = queryAt === -1 ? target : target.slice(0, queryAt);
  const rawQuery = queryAt === -1 ? '' : target.slice(queryAt);
  let pathname;
  try {
    pathname = decodeURIComponent(rawPath);
    // Validate before any redirect or normalization so /next/../ is never reclassified.
    if (pathname.includes('\0') || pathname.split(/[/\\]/).includes('..')) throw new Error('Invalid path');
  } catch {
    return sendText(res, 400, 'Bad request');
  }
  // The former /next prefix: permanent redirect to the same path at the root, relative Location, suffix and
  // query copied from the raw request target. A suffix that starts with a second slash or a backslash would
  // turn the Location into a scheme-relative URL (open redirect), so it is refused.
  const rest = rawRemainder(rawPath, '/next');
  if (rest !== null) {
    if (/^\/[/\\]/.test(rest)) return sendText(res, 400, 'Bad request');
    res.writeHead(301, { ...SECURITY_HEADERS, location: (rest || '/') + rawQuery });
    return res.end();
  }
  // Nothing serves a /next or /legacy path any more, not even through an encoded separator.
  if (/^\/(?:next|legacy)(?:\/|$)/.test(pathname)) return sendText(res, 404, 'Not found');
  let p = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, p));
    await sendStatic(req, res, p, body, MIME[extname(p)] ?? 'application/octet-stream');
  } catch {
    if (p.startsWith('/assets/')) return sendText(res, 404, 'Not found');
    try {
      const body = await readFile(join(ROOT, 'index.html'));
      await sendStatic(req, res, '/index.html', body, 'text/html');
    } catch {
      sendText(res, 404, 'Not found');
    }
  }
});

server.listen(PORT, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`web-console static server on :${actualPort}`);
});
