// TEST/DEPLOY-ONLY static server for the built web-console SPA (the web-console-next bundle, built at base /).
// Zero deps, zero filesystem writes (safe under readOnlyRootFilesystem),
// SPA fallback to index.html. Listens on :3000.
//
// The legacy console is not served: no flag, environment variable or path selects it. The former /next
// location answers a permanent relative redirect to the same path at the root (see redirectTarget below).
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

function badRequest(res) {
  res.writeHead(400, { ...SECURITY_HEADERS, 'content-type': 'text/plain' });
  res.end('Bad request');
}

function notFound(res) {
  res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain' });
  res.end('Not found');
}

// Percent-decode only the unreserved characters (ALPHA, DIGIT, "-", ".", "_", "~"), RFC 3986 section 6.2.2.2, so
// that /%6Eext is recognised as /next. Reserved characters such as %2F keep their encoding.
function normalizeUnreserved(segment) {
  return segment.replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return /[A-Za-z0-9._~-]/.test(char) ? char : match;
  });
}

// The single validation point for the /next redirect. `remainder` is the raw, still percent-encoded text after
// "/next/" and `query` is the raw text from "?" on. Returns the relative Location, or null when the request must be
// answered with 400: the remainder is decoded only to check it, never to build the result, so %2F, %23, %3F and %25
// reach the Location unchanged.
function validateRedirectPath(remainder, query) {
  if (!/^[\x21-\x7e]*$/.test(remainder + query)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(remainder);
  } catch {
    return null;
  }
  // Exactly one leading "/": no scheme-relative "//host", no "/\host", no backslash anywhere.
  if (decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0')) return null;
  if (decoded.split('/').includes('..')) return null;
  return `/${remainder}${query}`;
}

// Classifies a request target: { location } for /next and /next/*, { status: 400 } for an unsafe one, {} otherwise.
function redirectTarget(rawTarget) {
  const queryStart = rawTarget.indexOf('?');
  const rawPath = queryStart === -1 ? rawTarget : rawTarget.slice(0, queryStart);
  const query = queryStart === -1 ? '' : rawTarget.slice(queryStart);
  if (!rawPath.startsWith('/')) return {};
  const slash = rawPath.indexOf('/', 1);
  const segment = slash === -1 ? rawPath.slice(1) : rawPath.slice(1, slash);
  if (normalizeUnreserved(segment) !== 'next') return {};
  const location = validateRedirectPath(slash === -1 ? '' : rawPath.slice(slash + 1), query);
  return location === null ? { status: 400 } : { location };
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
  const redirect = redirectTarget(req.url ?? '/');
  if (redirect.status === 400) return badRequest(res);
  if (redirect.location !== undefined) {
    res.writeHead(301, { ...SECURITY_HEADERS, location: redirect.location, 'content-type': 'text/plain' });
    return res.end('Moved permanently');
  }
  let pathname;
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (pathname.includes('\0') || pathname.split(/[/\\]/).includes('..')) throw new Error('Invalid path');
  } catch {
    return badRequest(res);
  }
  // The legacy console is gone: no /legacy path answers 200, not even through the SPA fallback.
  if (pathname === '/legacy' || pathname.startsWith('/legacy/')) return notFound(res);
  let p = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  try {
    const body = await readFile(join(ROOT, p));
    await sendStatic(req, res, p, body, MIME[extname(p)] ?? 'application/octet-stream');
  } catch {
    if (p.startsWith('/assets/')) return notFound(res);
    try {
      const body = await readFile(join(ROOT, 'index.html'));
      await sendStatic(req, res, '/index.html', body, 'text/html');
    } catch {
      notFound(res);
    }
  }
});

server.listen(PORT, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : PORT;
  console.log(`web-console static server on :${actualPort}`);
});
