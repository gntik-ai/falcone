import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMMUTABLE = 'public, max-age=31536000, immutable';
const FAVICON_MAX_BYTES = 10 * 1024;
const REFERRER_POLICY = 'strict-origin-when-cross-origin';
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';

const staticServers = [
  {
    name: 'deploy kind static server',
    script: 'apps/web-console/static-server.mjs'
  },
  {
    name: 'app static server',
    script: 'apps/web-console/static-server.mjs'
  }
];

const CONTENT_SECURITY_POLICY = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'";
const SECURITY_HEADERS = {
  'content-security-policy': CONTENT_SECURITY_POLICY,
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': REFERRER_POLICY,
  'permissions-policy': PERMISSIONS_POLICY
};
const INDEX_HTML = '<!doctype html><main id="root">Next console</main>';
const nginxConfigs = [
  { name: 'production nginx.conf', path: 'apps/web-console/nginx.conf', proxiesV1: true },
  { name: 'kind nginx.conf', path: 'deploy/kind/web-console/nginx.conf', proxiesV1: false }
];

// Raw-socket HTTP/1.1 client: sends the request target exactly as given (no client-side normalisation) and
// returns the status, the lower-cased headers and the body. Every server under test answers with Content-Length.
function rawRequest(port, target, extraHeaders = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks = [];
    socket.on('connect', () => {
      const headers = Object.entries({ host: 'console.test', connection: 'close', ...extraHeaders }).map(([name, value]) => `${name}: ${value}\r\n`).join('');
      socket.write(`GET ${target} HTTP/1.1\r\n${headers}\r\n`);
    });
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', rejectResponse);
    socket.on('close', () => {
      const raw = Buffer.concat(chunks);
      const split = raw.indexOf('\r\n\r\n');
      const [statusLine, ...lines] = raw.subarray(0, split).toString('latin1').split('\r\n');
      const headers = Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 1).trim()]));
      let body = raw.subarray(split + 4);
      if (headers['transfer-encoding'] === 'chunked') {
        const decoded = [];
        for (let offset = 0; ;) {
          const lineEnd = body.indexOf('\r\n', offset);
          const size = Number.parseInt(body.subarray(offset, lineEnd).toString('latin1'), 16);
          if (!size) break;
          decoded.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
          offset = lineEnd + 2 + size + 2;
        }
        body = Buffer.concat(decoded);
      }
      resolveResponse({ statusCode: Number(statusLine.split(' ')[1]), headers, body: body.toString('utf8') });
    });
  });
}

async function freePort() {
  const probe = net.createServer();
  await new Promise((resolveListen) => probe.listen(0, '127.0.0.1', resolveListen));
  const { port } = probe.address();
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
}

async function findNginx() {
  for (const candidate of [...(process.env.PATH ?? '').split(':').map((directory) => join(directory, 'nginx')), '/usr/sbin/nginx', '/usr/local/nginx/sbin/nginx']) {
    try {
      await access(candidate);
      return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

// Renders a shipped nginx config as the nginx image would (envsubst of ${GATEWAY_UPSTREAM}), pointing only the
// listen port, the document root and the writable paths at a temporary directory. Nothing else is rewritten.
async function startNginx(t, nginx, configPath, root, upstreamPort) {
  const work = await mkdtemp(join(tmpdir(), 'falcone-nginx-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const port = await freePort();
  const template = await readFile(join(repoRoot, configPath), 'utf8');
  const rendered = template
    .replaceAll('${GATEWAY_UPSTREAM}', `127.0.0.1:${upstreamPort}`)
    .replace('listen 3000;', `listen 127.0.0.1:${port};`)
    .replace('root /usr/share/nginx/html;', `root ${root};`);
  assert.notEqual(rendered, template);
  const config = [
    'daemon off;', 'worker_processes 1;', `pid ${work}/nginx.pid;`, `error_log ${work}/error.log notice;`,
    'events { worker_connections 64; }',
    'http {',
    '  access_log off;',
    ...['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map((name) => `  ${name}_temp_path ${work}/${name};`),
    '  types { text/html html; text/css css; text/javascript js; application/json json; image/svg+xml svg; image/png png; }',
    rendered,
    '}'
  ].join('\n');
  await writeFile(join(work, 'nginx.conf'), config);
  const child = spawn(nginx, ['-c', join(work, 'nginx.conf'), '-p', `${work}/`, '-e', join(work, 'error.log')], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => stopProcess(child));
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`nginx exited: ${stderr}${await readFile(join(work, 'error.log'), 'utf8').catch(() => '')}`);
    try {
      await rawRequest(port, '/healthz');
      return { port };
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error(`nginx did not start listening: ${stderr}`);
}

// Redirect classification shared by static-server.mjs and both nginx configs; the expectations are literals.
const REDIRECTS = [
  ['/next', '/'], ['/next/', '/'], ['/next?x=1', '/?x=1'], ['/next/?x=1', '/?x=1'],
  ['/next/console/tenants', '/console/tenants'], ['/next/console/tenants?x=1', '/console/tenants?x=1'],
  ['/next/a%2Fb', '/a%2Fb'], ['/next/a%23b', '/a%23b'], ['/next/a%3Fb?x=1', '/a%3Fb?x=1'], ['/next/a%25b', '/a%25b'],
  ['/next/a%252Fb', '/a%252Fb'], ['/%6Eext/a%2Fb', '/a%2Fb'], ['/%6eext', '/'], ['/n%65xt/console?x=1', '/console?x=1'],
  ['/next/a?b=%2F&c=%23', '/a?b=%2F&c=%23']
];
const BAD_REDIRECTS = [
  '/next//evil.example', '/next/\\evil.example', '/next/%2F%2Fevil.example', '/next/%2Fevil.example', '/next/%5Cevil.example',
  '/next///evil.example', '/%6Eext//evil.example', '/next/a%5Cb',
  '/next/..', '/next/../', '/next/../index.html', '/next/%2e%2e/index.html', '/next/%2E%2E%2Findex.html', '/next/.%2e/x',
  '/next/a/../b', '/next/a%2F..%2Fb', '/next/assets/../../index.html'
];

async function assertSharedBehaviour(port, label) {
  for (const path of ['/', '/login', '/signup', '/console/tenants', '/console/flows/abc', '/index.html']) {
    const response = await rawRequest(port, path);
    assert.equal(response.statusCode, 200, `${label} ${path}`);
    assert.equal(response.body, INDEX_HTML, `${label} ${path}`);
    assert.equal(response.headers['cache-control'], 'no-store', `${label} ${path}`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers[name], value, `${label} ${path} ${name}`);
    assert.match(response.headers['content-type'], /^text\/html/, `${label} ${path}`);
  }
  const health = await rawRequest(port, '/healthz');
  assert.equal(health.statusCode, 200, `${label} /healthz`);
  assert.equal(health.body, 'ok', `${label} /healthz is not the index`);
  for (const [path, location] of REDIRECTS) {
    const response = await rawRequest(port, path);
    assert.equal(response.statusCode, 301, `${label} ${path}`);
    assert.equal(response.headers.location, location, `${label} ${path}`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers[name], value, `${label} ${path} ${name}`);
  }
  for (const path of BAD_REDIRECTS) {
    const response = await rawRequest(port, path);
    assert.equal(response.statusCode, 400, `${label} ${path}`);
    assert.equal(response.headers.location, undefined, `${label} ${path}`);
  }
  const asset = await rawRequest(port, '/assets/app.4f3c2a1b.js');
  assert.equal(asset.statusCode, 200, `${label} asset`);
  assert.equal(asset.headers['cache-control'], IMMUTABLE, `${label} asset`);
  assert.equal((await rawRequest(port, '/assets/missing.js')).statusCode, 404, `${label} missing asset`);
  for (const path of ['/legacy', '/legacy/', '/legacy/console/tenants']) assert.equal((await rawRequest(port, path)).statusCode, 404, `${label} ${path}`);
}

async function createNextRoot(t) {
  const { root } = await createDistRoot(t);
  await writeFile(join(root, 'index.html'), INDEX_HTML);
  return root;
}

async function startStub(t) {
  const upstream = http.createServer((req, res) => {
    res.writeHead(209, { 'content-type': 'application/json', 'x-upstream-path': req.url });
    res.end(JSON.stringify({ path: req.url, testHeader: req.headers['x-test'] }));
  });
  await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => upstream.close(resolveClose)));
  return upstream.address().port;
}

async function assertV1Proxy(port, label) {
  const response = await rawRequest(port, '/v1/x%2Fy?limit=1', { 'x-test': 'proxy-preserved' });
  assert.equal(response.statusCode, 209, `${label} /v1`);
  assert.equal(response.headers['x-upstream-path'], '/v1/x%2Fy?limit=1', `${label} /v1 reaches the upstream intact`);
  assert.deepEqual(JSON.parse(response.body), { path: '/v1/x%2Fy?limit=1', testHeader: 'proxy-preserved' });
  for (const name of Object.keys(SECURITY_HEADERS)) assert.equal(response.headers[name], undefined, `${label} /v1 carries no ${name}`);
}

test('serves the next index, redirects /next and answers /healthz (runtime)', async (t) => {
  await t.test('static-server.mjs', async (t) => {
    const root = await createNextRoot(t);
    const upstreamPort = await startStub(t);
    const { port } = await startStaticServer(t, 'apps/web-console/static-server.mjs', root, { GATEWAY_UPSTREAM: `127.0.0.1:${upstreamPort}` });
    await assertSharedBehaviour(port, 'static-server');
    await assertV1Proxy(port, 'static-server');
    // static-server.mjs also validates malformed escapes and traversal outside /next.
    for (const path of ['/x/../y', '/next/%00', '/next/%zz', '/next/a%', '/%2e%2e/index.html']) {
      assert.equal((await rawRequest(port, path)).statusCode, 400, path);
    }
  });
  const nginx = await findNginx();
  for (const config of nginxConfigs) {
    await t.test(`${config.name} (nginx)`, { skip: nginx ? false : 'nginx is not installed here; PR CI runs this runtime check' }, async (t) => {
      const root = await createNextRoot(t);
      const upstreamPort = await startStub(t);
      const { port } = await startNginx(t, nginx, config.path, root, upstreamPort);
      await assertSharedBehaviour(port, config.name);
      if (config.proxiesV1) await assertV1Proxy(port, config.name);
    });
  }
});

async function createDistRoot(t) {
  const root = await mkdtemp(join(tmpdir(), 'falcone-web-console-static-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets'));

  const files = {
    '/index.html': '<!doctype html><main id="root">Falcone</main>',
    '/assets/app.4f3c2a1b.js': `const payload = ${JSON.stringify('falcone-console-js;'.repeat(4096))};\nconsole.log(payload.length);\n`,
    '/assets/theme.9a8b7c6d.css': `.console-shell { color: #111827; background: #f8fafc; }\n${'.grid-row { display: grid; gap: 8px; }\n'.repeat(2048)}`,
    '/assets/config.aabbccdd.json': JSON.stringify({ feature: 'static-delivery', values: Array(1024).fill('cache-compress') }),
    '/assets/logo.0f1e2d3c.svg': `<svg xmlns="http://www.w3.org/2000/svg">${'<path d="M0 0h10v10H0z"/>'.repeat(1024)}</svg>`,
    '/assets/icon.01020304.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00])
  };

  await Promise.all(Object.entries(files).map(([path, body]) => writeFile(join(root, path), body)));
  return { root, files };
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try {
    await once(child, 'exit');
  } finally {
    clearTimeout(timer);
  }
}

function startStaticServer(t, script, root, extraEnv = {}) {
  const child = spawn(process.execPath, [script], {
    cwd: repoRoot,
    env: {
      ...process.env,
      WEB_CONSOLE_STATIC_ROOT: root,
      PORT: '0',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => stopProcess(child));

  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${script} to listen. stderr: ${stderr}`)), 5000);

    function finish(error, port) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectReady(error);
      else resolveReady({ child, port });
    }

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      const match = stdout.match(/web-console static server on :(\d+)/);
      if (match) finish(null, Number(match[1]));
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('exit', (code, signal) => {
      finish(new Error(`${script} exited before listening: code=${code} signal=${signal} stderr=${stderr}`));
    });
    child.on('error', finish);
  });
}

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolveResponse({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on('error', rejectResponse);
    if (body) req.write(body);
    req.end();
  });
}

function assertCompressed(response, encoding, rawBody) {
  assert.equal(response.statusCode, 200);
  assertSecurityHeaders(response.headers, `${encoding} compressed asset`);
  assert.equal(response.headers['content-encoding'], encoding);
  assert.equal(response.headers['cache-control'], IMMUTABLE);
  assert.match(response.headers.vary ?? '', /Accept-Encoding/i);
  assert.ok(
    response.body.length < Buffer.byteLength(rawBody) * 0.5,
    `expected ${encoding} response to be materially smaller than raw bytes`
  );

  const decompressed = encoding === 'br' ? brotliDecompressSync(response.body) : gunzipSync(response.body);
  assert.equal(decompressed.toString('utf8'), rawBody);
}

function parseCsp(header) {
  return new Map(
    header
      .split(';')
      .map((directive) => directive.trim())
      .filter(Boolean)
      .map((directive) => {
        const [name, ...values] = directive.split(/\s+/);
        return [name.toLowerCase(), values];
      })
  );
}

function assertSecurityHeaders(headers, label = 'response') {
  assert.ok(headers['content-security-policy'], `${label} includes Content-Security-Policy`);
  assert.equal(headers['x-frame-options'], 'DENY', `${label} denies framing via X-Frame-Options`);
  assert.equal(headers['x-content-type-options'], 'nosniff', `${label} disables content sniffing`);
  assert.equal(headers['referrer-policy'], REFERRER_POLICY, `${label} sets a referrer policy`);
  assert.equal(headers['permissions-policy'], PERMISSIONS_POLICY, `${label} sets a permissions policy`);

  const csp = parseCsp(headers['content-security-policy']);
  assert.deepEqual(csp.get('frame-ancestors'), ["'none'"], `${label} denies all framing via CSP`);
  assert.deepEqual(csp.get('script-src'), ["'self'"], `${label} constrains scripts to self`);
  assert.deepEqual(csp.get('default-src'), ["'self'"], `${label} constrains default loads to self`);
  assert.deepEqual(csp.get('object-src'), ["'none'"], `${label} disables plugin/object execution`);
  assert.deepEqual(csp.get('base-uri'), ["'self'"], `${label} constrains base URI mutation`);
  assert.deepEqual(csp.get('connect-src'), ["'self'"], `${label} keeps console API traffic same-origin`);
  assert.deepEqual(csp.get('form-action'), ["'self'"], `${label} constrains form submissions`);

  const scriptSrc = csp.get('script-src') ?? [];
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), `${label} does not allow inline scripts`);
  assert.ok(!scriptSrc.includes("'unsafe-eval'"), `${label} does not allow eval-like script execution`);
  assert.ok(!scriptSrc.includes('*'), `${label} does not allow wildcard script origins`);
}

function assertNginxSecurityHeaderSource(source, name, scope) {
  assert.match(
    source,
    /add_header\s+Content-Security-Policy\s+"[^"]*frame-ancestors 'none'[^"]*script-src 'self'[^"]*"\s+always;/,
    `${name} ${scope} declares CSP with frame denial and self-only scripts`
  );
  assert.match(source, /add_header\s+X-Frame-Options\s+"DENY"\s+always;/, `${name} ${scope} denies framing`);
  assert.match(source, /add_header\s+X-Content-Type-Options\s+"nosniff"\s+always;/, `${name} ${scope} disables sniffing`);
  assert.match(
    source,
    /add_header\s+Referrer-Policy\s+"strict-origin-when-cross-origin"\s+always;/,
    `${name} ${scope} declares referrer policy`
  );
  assert.match(source, /add_header\s+Permissions-Policy\s+"[^"]+"\s+always;/, `${name} ${scope} declares permissions policy`);
}

function extractNginxLocation(source, pattern, name, scope) {
  const match = source.match(pattern);
  assert.ok(match, `${name} declares ${scope}`);
  return match[1];
}

test('nginx configs redirect /next from the raw request target and keep headers off proxied and health responses', async () => {
  for (const config of nginxConfigs) {
    const source = await readFile(join(repoRoot, config.path), 'utf8');
    assert.doesNotMatch(source, /\/app\/dist-next|^\s*location[^\n{]*\/next\//m, `${config.name} has no /next bundle locations`);
    assert.doesNotMatch(source, /^\s*rewrite\s/m, `${config.name} never rewrites (rewrite re-escapes the target)`);
    assert.match(source, /map\s+\$request_uri\s+\$web_console_next_target\s*\{/, `${config.name} classifies the raw $request_uri`);
    const redirect = extractNginxLocation(source, /location @web_console_next_redirect \{([\s\S]*?)\n  \}/, config.name, 'redirect location');
    assert.match(redirect, /absolute_redirect\s+off;/, `${config.name} emits a relative Location`);
    assert.match(redirect, /return\s+301\s+\$web_console_next_target;/, `${config.name} redirects with 301`);
    assert.match(redirect, /return\s+400;/, `${config.name} rejects unsafe targets`);
    assertNginxSecurityHeaderSource(redirect, config.name, 'redirect location');
    const serverLevel = source.slice(source.indexOf('server {')).replace(/^ {2}location[\s\S]*?^ {2}\}\n/gm, '');
    assert.doesNotMatch(serverLevel, /add_header/, `${config.name} adds no server-level header (it would reach proxied /v1/ responses)`);
    const legacy = extractNginxLocation(source, /location ~ \^\/legacy\(\?:\/\|\$\) \{([\s\S]*?)\n  \}/, config.name, '/legacy location');
    assert.match(legacy, /return\s+404;/, `${config.name} serves nothing at /legacy`);
    assert.ok(source.indexOf('location = /healthz') < source.indexOf('\n  location / {'), `${config.name} answers /healthz before the SPA fallback`);
    const health = extractNginxLocation(source, /location = \/healthz \{([\s\S]*?)\n  \}/, config.name, 'healthz location');
    assert.match(health, /return\s+200\s+"ok";/, `${config.name} answers ok`);
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLinkAttributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/\s([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((match) => [
      match[1].toLowerCase(),
      match[2] ?? match[3] ?? ''
    ])
  );
}

test('web console declares a lightweight SVG-capable favicon asset', async () => {
  const indexHtml = (await readFile(join(repoRoot, 'apps/web-console-next/index.html'), 'utf8')).replaceAll('%BASE_URL%', '/');
  const iconLinks = [...indexHtml.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => parseLinkAttributes(match[0]))
    .filter((attributes) => (attributes.rel ?? '').split(/\s+/).includes('icon'));

  assert.ok(iconLinks.length > 0, 'index.html declares at least one favicon');

  const primaryIcon = iconLinks.find((attributes) => attributes.type === 'image/svg+xml') ?? iconLinks[0];
  assert.ok(primaryIcon.href, 'primary favicon declares an href');
  assert.match(primaryIcon.href, /^\//, 'primary favicon uses an app-root public path');

  const assetPath = join(repoRoot, 'apps/web-console-next/public', primaryIcon.href.slice(1));
  const assetStats = await stat(assetPath);
  assert.ok(
    assetStats.size <= FAVICON_MAX_BYTES,
    `expected ${primaryIcon.href} to be <= ${FAVICON_MAX_BYTES} bytes, got ${assetStats.size}`
  );

  if ((primaryIcon.type ?? '').includes('svg') || primaryIcon.href.endsWith('.svg')) {
    const faviconSvg = await readFile(assetPath, 'utf8');
    assert.match(faviconSvg, /<svg\b/i, 'SVG favicon is an SVG document');
    assert.doesNotMatch(
      faviconSvg,
      /href\s*=\s*["']data:image\/(?:png|jpe?g|gif|webp);base64,/i,
      'SVG favicon must not embed a raster image as a base64 data URL'
    );
  }
});

for (const server of staticServers) {
  test(`${server.name} compresses assets and sets cache and security headers`, async (t) => {
    const { root, files } = await createDistRoot(t);
    const { port } = await startStaticServer(t, server.script, root);

    const brJs = await request(port, '/assets/app.4f3c2a1b.js', {
      headers: { 'accept-encoding': 'gzip, br' }
    });
    assertCompressed(brJs, 'br', files['/assets/app.4f3c2a1b.js']);

    const gzipCss = await request(port, '/assets/theme.9a8b7c6d.css', {
      headers: { 'accept-encoding': 'br;q=0, gzip' }
    });
    assertCompressed(gzipCss, 'gzip', files['/assets/theme.9a8b7c6d.css']);

    const gzipJson = await request(port, '/assets/config.aabbccdd.json', {
      headers: { 'accept-encoding': 'gzip' }
    });
    assertCompressed(gzipJson, 'gzip', files['/assets/config.aabbccdd.json']);

    const gzipSvg = await request(port, '/assets/logo.0f1e2d3c.svg', {
      headers: { 'accept-encoding': 'gzip' }
    });
    assertCompressed(gzipSvg, 'gzip', files['/assets/logo.0f1e2d3c.svg']);

    const png = await request(port, '/assets/icon.01020304.png', {
      headers: { 'accept-encoding': 'br, gzip' }
    });
    assert.equal(png.statusCode, 200);
    assertSecurityHeaders(png.headers, `${server.name} PNG asset`);
    assert.equal(png.headers['cache-control'], IMMUTABLE);
    assert.equal(png.headers['content-encoding'], undefined);
    assert.equal(png.headers.vary, undefined);
    assert.deepEqual(png.body, files['/assets/icon.01020304.png']);

    const rootResponse = await request(port, '/');
    assert.equal(rootResponse.statusCode, 200);
    assertSecurityHeaders(rootResponse.headers, `${server.name} root shell`);
    assert.equal(rootResponse.headers['cache-control'], 'no-store');
    assert.equal(rootResponse.body.toString('utf8'), files['/index.html']);

    const index = await request(port, '/index.html', {
      headers: { 'accept-encoding': 'br, gzip' }
    });
    assert.equal(index.statusCode, 200);
    assertSecurityHeaders(index.headers, `${server.name} index shell`);
    assert.equal(index.headers['cache-control'], 'no-store');
    assert.equal(index.headers['content-encoding'], undefined);
    assert.equal(index.body.toString('utf8'), files['/index.html']);

    const login = await request(port, '/login');
    assert.equal(login.statusCode, 200);
    assertSecurityHeaders(login.headers, `${server.name} /login SPA fallback`);
    assert.equal(login.headers['cache-control'], 'no-store');
    assert.equal(login.body.toString('utf8'), files['/index.html']);

    const spaFallback = await request(port, '/console/workspaces/demo');
    assert.equal(spaFallback.statusCode, 200);
    assertSecurityHeaders(spaFallback.headers, `${server.name} SPA fallback`);
    assert.equal(spaFallback.headers['cache-control'], 'no-store');
    assert.equal(spaFallback.body.toString('utf8'), files['/index.html']);

    const healthz = await request(port, '/healthz');
    assert.equal(healthz.statusCode, 200);
    assert.equal(healthz.body.toString('utf8'), 'ok');
  });
}

test('deploy kind static server keeps the same-origin /v1 proxy ahead of the SPA fallback', async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(209, {
      'content-type': 'application/json',
      'x-upstream-path': req.url
    });
    res.end(JSON.stringify({ method: req.method, path: req.url, testHeader: req.headers['x-test'] }));
  });
  await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => upstream.close(resolveClose)));

  const upstreamAddress = upstream.address();
  const { root } = await createDistRoot(t);
  const { port } = await startStaticServer(t, 'apps/web-console/static-server.mjs', root, {
    GATEWAY_UPSTREAM: `127.0.0.1:${upstreamAddress.port}`
  });

  const response = await request(port, '/v1/projects?limit=1', {
    headers: { 'x-test': 'proxy-preserved' }
  });

  assert.equal(response.statusCode, 209);
  assert.equal(response.headers['x-upstream-path'], '/v1/projects?limit=1');
  assert.deepEqual(JSON.parse(response.body.toString('utf8')), {
    method: 'GET',
    path: '/v1/projects?limit=1',
    testHeader: 'proxy-preserved'
  });
});

test('legacy nginx static-serving configs declare gzip, cache-control, and security-header parity', async () => {
  const configs = [
    {
      name: 'production web-console nginx',
      path: 'apps/web-console/nginx.conf',
      requiresHealthz: true
    },
    {
      name: 'kind web-console nginx',
      path: 'deploy/kind/web-console/nginx.conf',
      requiresHealthz: true
    }
  ];

  for (const config of configs) {
    const source = await readFile(join(repoRoot, config.path), 'utf8');
    const indexLocation = extractNginxLocation(
      source,
      /location\s+=\s+\/index\.html\s*\{([\s\S]*?)\n\s*\}/,
      config.name,
      'index.html location'
    );
    assertNginxSecurityHeaderSource(indexLocation, config.name, 'index.html location');

    const assetsLocation = extractNginxLocation(
      source,
      /location\s+\/assets\/\s*\{([\s\S]*?)\n\s*\}/,
      config.name,
      'assets location'
    );
    assertNginxSecurityHeaderSource(assetsLocation, config.name, 'assets location');

    const shellLocation = extractNginxLocation(
      source,
      /location\s+\/\s*\{([\s\S]*?)\n\s*\}/,
      config.name,
      'SPA shell fallback location'
    );
    assertNginxSecurityHeaderSource(shellLocation, config.name, 'SPA shell fallback location');

    assert.match(source, /gzip\s+on;/, `${config.name} enables gzip`);
    assert.match(source, /gzip_vary\s+on;/, `${config.name} varies compressed assets by Accept-Encoding`);
    for (const type of ['text/css', 'text/javascript', 'application/javascript', 'application/json', 'image/svg+xml']) {
      assert.match(source, new RegExp(`gzip_types[\\s\\S]*${escapeRegex(type)}`), `${config.name} gzips ${type}`);
    }
    assert.match(
      source,
      /location\s+=\s+\/index\.html\s*\{[\s\S]*add_header\s+Cache-Control\s+'no-store'/,
      `${config.name} sets no-store on index.html`
    );
    assert.match(
      source,
      /location\s+\/assets\/\s*\{[\s\S]*add_header\s+Cache-Control\s+'public, max-age=31536000, immutable'/,
      `${config.name} sets immutable cache-control on assets`
    );
    assert.match(source, /location\s+\/\s*\{[^}]*try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/, `${config.name} keeps SPA fallback`);
    if (config.requiresHealthz) {
      assert.match(source, /location\s+=\s+\/healthz\s*\{[^}]*return\s+200\s+"ok";/, `${config.name} keeps healthz`);
    }
  }
});
