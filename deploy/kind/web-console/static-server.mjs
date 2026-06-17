// TEST/DEPLOY-ONLY static server for the built web-console SPA.
// Zero deps, zero filesystem writes (safe under readOnlyRootFilesystem),
// SPA fallback to index.html. Listens on :3000.
//
// Same-origin API edge (fix-console-edge-routing, #505): the SPA issues relative /v1/* API calls;
// without an edge the SPA fallback below returned index.html (HTML) for every API request. We
// reverse-proxy /v1/* to the gateway (APISIX → control-plane; GATEWAY_UPSTREAM, default
// falcone-apisix:9080), preserving method/headers/body so the browser reaches the backend.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
const ROOT = '/app/dist';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.woff2':'font/woff2', '.map':'application/json' };
const [GW_HOST, GW_PORT = '9080'] = (process.env.GATEWAY_UPSTREAM ?? 'falcone-apisix:9080').split(':');
http.createServer(async (req, res) => {
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
