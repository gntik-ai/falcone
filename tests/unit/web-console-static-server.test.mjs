import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

// Every /next request is a permanent redirect with a relative Location. The suffix and the query are copied
// byte for byte from the raw request target, a percent-encoded unreserved prefix is the same prefix, and
// traversal is refused before any redirect. Both servers must agree on every row.
const NEXT_REDIRECTS = [
  ['/next', '/'],
  ['/next/', '/'],
  ['/next?x=1', '/?x=1'],
  ['/next/console/tenants?x=1', '/console/tenants?x=1'],
  ['/next/a%2Fb', '/a%2Fb'],
  ['/next/a%23b', '/a%23b'],
  ['/next/a%3Fb?x=1', '/a%3Fb?x=1'],
  ['/next/a%25b', '/a%25b'],
  ['/%6Eext/a%2Fb', '/a%2Fb']
];
const NEXT_REFUSALS = [
  ['/next/../index.html', 400],
  ['/next/%2e%2e/index.html', 400],
  ['/next/a/..?x=1', 400],
  ['/%6Eext/%2e%2e/x', 400],
  ['/x/../y', 400],
  ['/next//evil.example', 400],
  ['/next/\\evil.example', 400],
  ['/next%2Fa', 404],
  ['/legacy', 404],
  ['/legacy/console/tenants', 404]
];

async function assertNextRedirects(port, label) {
  for (const [path, location] of NEXT_REDIRECTS) {
    const response = await request(port, path);
    assert.equal(response.statusCode, 301, `${label} ${path}`);
    assert.equal(response.headers.location, location, `${label} ${path}`);
    assertSecurityHeaders(response.headers, `${label} ${path} redirect`);
  }
  for (const [path, status] of NEXT_REFUSALS) {
    const response = await request(port, path);
    assert.equal(response.statusCode, status, `${label} ${path}`);
    assert.equal(response.headers.location, undefined, `${label} ${path}`);
  }
}

// Targets that nginx would normalise into another location (/healthz, /v1/, the SPA) must still be refused on the raw
// target, as static-server.mjs does.
const TRAVERSAL_REFUSALS = [
  '/next/../healthz', '/next/%2e%2e/healthz', '/next/%2E%2E%2Fhealthz', '/x/../healthz', '/%2e%2e/healthz',
  '/x/../v1/foo', '/next/../v1/foo', '/x/%2e%2e/v1/foo', '/assets/../../outside.html', '/next/a/..?x=1', '/%00'
];

// nginx's own request parser answers these with a bare 400 before any location runs (a target that climbs above the
// root, or a NUL), so that response carries none of the configured headers. The status and the absence of a
// redirect are still required of it.
const NGINX_CORE_REFUSALS = new Set(['/%2e%2e/healthz', '/assets/../../outside.html', '/%00']);

async function assertTraversalRefused(port, label, { server = 'node' } = {}) {
  for (const path of TRAVERSAL_REFUSALS) {
    const response = await request(port, path);
    assert.equal(response.statusCode, 400, `${label} ${path}`);
    assert.equal(response.headers.location, undefined, `${label} ${path}`);
    if (!(server === 'nginx' && NGINX_CORE_REFUSALS.has(path))) assertSecurityHeaders(response.headers, `${label} ${path} refusal`);
    assert.notEqual(response.body.toString(), 'ok', `${label} ${path} is not the health probe`);
  }
}

async function assertConsoleRoutes(port, label, index) {
  for (const path of ['/', '/login', '/signup', '/console/tenants', '/console/flows/abc']) {
    const response = await request(port, path);
    assert.equal(response.statusCode, 200, `${label} ${path}`);
    assert.equal(response.body.toString(), index, `${label} ${path}`);
    assert.equal(response.headers['cache-control'], 'no-store', `${label} ${path}`);
    assertSecurityHeaders(response.headers, `${label} ${path}`);
  }
  const missing = await request(port, '/assets/missing.0000.js');
  assert.equal(missing.statusCode, 404, `${label} missing asset`);
  const health = await request(port, '/healthz');
  assert.equal(health.statusCode, 200, `${label} /healthz`);
  assert.equal(health.body.toString(), 'ok', `${label} /healthz serves ok, not the SPA index`);
}

test('static server redirects /next to the root over a real socket, byte for byte', async (t) => {
  const { root, files } = await createDistRoot(t);
  const { port } = await startStaticServer(t, 'apps/web-console/static-server.mjs', root);
  await assertNextRedirects(port, 'static server');
  await assertTraversalRefused(port, 'static server');
  await assertConsoleRoutes(port, 'static server', files['/index.html']);
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

test('nginx configs redirect /next with one relative, raw-target location and keep /v1 undecorated', async () => {
  for (const path of ['apps/web-console/nginx.conf', 'deploy/kind/web-console/nginx.conf']) {
    const source = await readFile(join(repoRoot, path), 'utf8');
    const redirect = extractNginxLocation(source, /location ~ "\^\/next\(\?:\/\|\$\)" \{([\s\S]*?)\n  \}/, path, '/next redirect location');
    assertNginxSecurityHeaderSource(redirect, path, '/next redirect location');
    assert.match(redirect, /absolute_redirect off;/, `${path} keeps the Location relative`);
    assert.match(redirect, /\$request_uri/, `${path} builds the target from the raw request URI`);
    assert.doesNotMatch(redirect.replace(/#.*$/gm, ''), /\$uri\b/, `${path} never builds the target from the decoded URI`);
    assert.match(redirect, /return 301 \$next_location;/);
    assert.doesNotMatch(source, /location\s+=\s+\/next\b|location\s+\/next\/|dist-next|alias\s/, `${path} has no unreachable /next serving blocks`);
    // Security headers sit on locations only: a server-level add_header would reach proxied /v1/ responses.
    // The traversal guard runs at server level, before location dispatch, and answers through a headed internal location.
    assert.match(source, /\n  if \(\$bad_target\) \{ rewrite \^ \/__bad_target last; \}/, `${path} refuses traversal before location dispatch`);
    const refusal = extractNginxLocation(source, /location = \/__bad_target \{([\s\S]*?)\n  \}/, path, 'traversal refusal location');
    assertNginxSecurityHeaderSource(refusal, path, 'traversal refusal location');
    assert.match(refusal, /\binternal;/);
    assert.match(refusal, /return 400\b/);
    assert.ok(source.indexOf('rewrite ^ /__bad_target last') < source.indexOf('\n  location '), `${path} guards before the first location`);
    const serverLevel = source.replace(/\n  location [^\n]*\{[\s\S]*?\n  \}/g, '');
    assert.doesNotMatch(serverLevel, /add_header/, `${path} declares no server-level headers`);
  }
  const production = await readFile(join(repoRoot, 'apps/web-console/nginx.conf'), 'utf8');
  const v1 = extractNginxLocation(production, /location \/v1\/ \{([\s\S]*?)\n  \}/, 'nginx', '/v1 proxy');
  assert.doesNotMatch(v1, /add_header/);
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
    assert.match(source, /location\s+\/\s*\{[\s\S]*?try_files\s+\$uri\s+\$uri\/\s+\/index\.html;/, `${config.name} keeps SPA fallback`);
    if (config.requiresHealthz) {
      assert.match(source, /location\s+=\s+\/healthz\s*\{[^}]*return\s+200\s+"ok";/, `${config.name} keeps healthz`);
      assert.ok(source.search(/location\s+=\s+\/healthz\b/) < source.search(/location\s+\/\s*\{/), `${config.name} declares healthz before the SPA fallback`);
    }
  }
});

// Runtime checks of the shipped nginx configs. They need an nginx binary: when it is absent (the maker
// sandbox) they are skipped here and run in PR CI, where the web-console job installs nginx.
const nginxBinary = spawnSync('nginx', ['-v'], { encoding: 'utf8' }).error ? null : 'nginx';

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = net.createServer();
    probe.on('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

async function startNginx(t, confPath, root, upstreamPort) {
  const dir = await mkdtemp(join(tmpdir(), 'falcone-nginx-'));
  const port = await freePort();
  const site = (await readFile(join(repoRoot, confPath), 'utf8'))
    .replace('listen 3000;', `listen 127.0.0.1:${port};`)
    .replaceAll('/usr/share/nginx/html', root)
    .replaceAll('${GATEWAY_UPSTREAM}', `127.0.0.1:${upstreamPort}`);
  await writeFile(join(dir, 'site.conf'), site);
  await writeFile(join(dir, 'nginx.conf'), [
    'daemon off;',
    'worker_processes 1;',
    `pid ${dir}/nginx.pid;`,
    `error_log ${dir}/error.log;`,
    'events { worker_connections 64; }',
    'http {',
    '  access_log off;',
    '  default_type application/octet-stream;',
    '  types { text/html html; text/javascript js; text/css css; application/json json; }',
    ...['client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'].map((name) => `  ${name}_temp_path ${dir}/${name};`),
    `  include ${dir}/site.conf;`,
    '}'
  ].join('\n'));
  const child = spawn(nginxBinary, ['-p', `${dir}/`, '-c', join(dir, 'nginx.conf'), '-e', join(dir, 'error.log')], { stdio: 'ignore' });
  t.after(async () => {
    await stopProcess(child);
    await rm(dir, { recursive: true, force: true });
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const health = await request(port, '/healthz');
      if (health.statusCode === 200) return { port, errorLog: join(dir, 'error.log') };
    } catch {
      // not listening yet
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`nginx did not start for ${confPath}: ${await readFile(join(dir, 'error.log'), 'utf8').catch(() => '')}`);
}

// A failed assertion carries nginx's own error log, so a CI failure names the request nginx mishandled.
async function withNginxLog(errorLog, run) {
  try {
    await run();
  } catch (error) {
    const log = await readFile(errorLog, 'utf8').catch(() => '');
    if (error instanceof Error) error.message += `\nnginx error.log:\n${log || '(empty)'}`;
    throw error;
  }
}

for (const confPath of ['apps/web-console/nginx.conf', 'deploy/kind/web-console/nginx.conf']) {
  test(`${confPath} serves the next index, redirects /next and answers /healthz (runtime)`, { skip: nginxBinary ? false : 'nginx is not installed; PR CI runs this' }, async (t) => {
    const { root, files } = await createDistRoot(t);
    const { port, errorLog } = await startNginx(t, confPath, root, 9);
    await t.test('serves the next index at every console route and answers /healthz', () => withNginxLog(errorLog, () => assertConsoleRoutes(port, confPath, files['/index.html'])));
    await t.test('redirects /next byte for byte and refuses unsafe targets', () => withNginxLog(errorLog, () => assertNextRedirects(port, confPath)));
    await t.test('refuses traversal before location dispatch', () => withNginxLog(errorLog, () => assertTraversalRefused(port, confPath, { server: 'nginx' })));
    await t.test('serves assets immutable', () => withNginxLog(errorLog, async () => {
      const asset = await request(port, '/assets/app.4f3c2a1b.js');
      assert.equal(asset.statusCode, 200);
      assert.equal(asset.headers['cache-control'], IMMUTABLE);
    }));
  });
}

test('production nginx proxies /v1 unmodified and without security headers (runtime)', { skip: nginxBinary ? false : 'nginx is not installed; PR CI runs this' }, async (t) => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(209, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ path: req.url }));
  });
  await new Promise((resolveListen) => upstream.listen(0, '127.0.0.1', resolveListen));
  t.after(() => new Promise((resolveClose) => upstream.close(resolveClose)));
  const { root } = await createDistRoot(t);
  const { port } = await startNginx(t, 'apps/web-console/nginx.conf', root, upstream.address().port);
  const response = await request(port, '/v1/x?y=1');
  assert.equal(response.statusCode, 209);
  assert.deepEqual(JSON.parse(response.body.toString()), { path: '/v1/x?y=1' });
  assert.equal(response.headers['content-security-policy'], undefined);
  // A genuine /v1 request is not filtered, even with a dot segment; one that only normalises into /v1/ is refused.
  const dotted = await request(port, '/v1/a/../b?y=1');
  assert.equal(dotted.statusCode, 209);
  assert.equal(dotted.headers['content-security-policy'], undefined);
  const disguised = await request(port, '/x/../v1/foo');
  assert.equal(disguised.statusCode, 400);
});
