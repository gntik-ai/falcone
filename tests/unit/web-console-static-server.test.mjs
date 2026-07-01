import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IMMUTABLE = 'public, max-age=31536000, immutable';
const FAVICON_MAX_BYTES = 10 * 1024;

const staticServers = [
  {
    name: 'deploy kind static server',
    script: 'deploy/kind/web-console/static-server.mjs'
  },
  {
    name: 'app static server',
    script: 'apps/web-console/static-server.mjs'
  }
];

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
  const indexHtml = await readFile(join(repoRoot, 'apps/web-console/index.html'), 'utf8');
  const iconLinks = [...indexHtml.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => parseLinkAttributes(match[0]))
    .filter((attributes) => (attributes.rel ?? '').split(/\s+/).includes('icon'));

  assert.ok(iconLinks.length > 0, 'index.html declares at least one favicon');

  const primaryIcon = iconLinks.find((attributes) => attributes.type === 'image/svg+xml') ?? iconLinks[0];
  assert.ok(primaryIcon.href, 'primary favicon declares an href');
  assert.match(primaryIcon.href, /^\//, 'primary favicon uses an app-root public path');

  const assetPath = join(repoRoot, 'apps/web-console/public', primaryIcon.href.slice(1));
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
  test(`${server.name} compresses compressible assets and sets static cache headers`, async (t) => {
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
    assert.equal(png.headers['cache-control'], IMMUTABLE);
    assert.equal(png.headers['content-encoding'], undefined);
    assert.equal(png.headers.vary, undefined);
    assert.deepEqual(png.body, files['/assets/icon.01020304.png']);

    const index = await request(port, '/index.html', {
      headers: { 'accept-encoding': 'br, gzip' }
    });
    assert.equal(index.statusCode, 200);
    assert.equal(index.headers['cache-control'], 'no-store');
    assert.equal(index.headers['content-encoding'], undefined);
    assert.equal(index.body.toString('utf8'), files['/index.html']);

    const spaFallback = await request(port, '/console/workspaces/demo');
    assert.equal(spaFallback.statusCode, 200);
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
  const { port } = await startStaticServer(t, 'deploy/kind/web-console/static-server.mjs', root, {
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

test('nginx static serving configs declare gzip and cache-control parity', async () => {
  const configs = [
    {
      name: 'production web-console nginx',
      path: 'apps/web-console/nginx.conf',
      requiresHealthz: false
    },
    {
      name: 'kind web-console nginx',
      path: 'deploy/kind/web-console/nginx.conf',
      requiresHealthz: true
    }
  ];

  for (const config of configs) {
    const source = await readFile(join(repoRoot, config.path), 'utf8');
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
