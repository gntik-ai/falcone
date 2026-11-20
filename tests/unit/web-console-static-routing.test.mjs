import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

// Mock only the HTTP transport boundary; requests exercise the shipped server callback
// and real filesystem. This also runs in sandboxes that prohibit listening sockets.
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};
let instance = 0;
async function fixture(t, { absentIndex = false, env = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'console-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(root, 'outside.html'), 'outside-root');
  if (!absentIndex) await writeFile(join(dist, 'index.html'), '<main>Next console</main>');
  await writeFile(join(dist, 'assets/app.abc123.js'), 'next();');
  for (const [key, value] of Object.entries({ WEB_CONSOLE_STATIC_ROOT: dist, GATEWAY_UPSTREAM: 'gateway.test:9081', ...env })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  let handler;
  t.mock.method(http, 'createServer', (callback) => {
    handler = callback;
    return { listen(_port, ready) { ready(); }, address() { return { port: 0 }; } };
  });
  await import(`../../apps/web-console/static-server.mjs?test=${++instance}`);
  return async (url, extra = {}) => {
    let response;
    let resolveEnd;
    const ended = new Promise((resolve) => { resolveEnd = resolve; });
    const req = Object.assign(Readable.from(extra.body ? [extra.body] : []), { url, method: 'GET', headers: {}, ...extra });
    await handler(req, {
      writeHead(status, headers = {}) { response = { status, headers }; },
      end(body) { response.body = Buffer.from(body ?? '').toString(); resolveEnd(); }
    });
    await ended;
    return response;
  };
}

test('the root and every deep link return the next index with no-store and the exact security headers', async (t) => {
  const request = await fixture(t);
  for (const path of ['/', '/login', '/signup', '/console/tenants', '/console/flows/abc', '/index.html', '/nextish', '/console/tenants?x=1']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, '<main>Next console</main>', path);
    assert.deepEqual(response.headers, { ...SECURITY_HEADERS, 'content-type': 'text/html', 'cache-control': 'no-store' }, path);
  }
});

test('no flag, environment variable or path serves a legacy bundle', async (t) => {
  const legacy = await mkdtemp(join(tmpdir(), 'console-legacy-'));
  t.after(() => rm(legacy, { recursive: true, force: true }));
  await writeFile(join(legacy, 'index.html'), '<main>Legacy console</main>');
  const request = await fixture(t, { env: { WEB_CONSOLE_NEXT_STATIC_ROOT: legacy, WEB_CONSOLE_LEGACY: 'true', WEB_CONSOLE_LEGACY_STATIC_ROOT: legacy } });
  for (const path of ['/', '/login', '/index.html', '/?legacy=1']) assert.equal((await request(path)).body, '<main>Next console</main>', path);
  for (const path of ['/legacy', '/legacy/', '/legacy/console/tenants', '/legacy/index.html']) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body, 'Not found', path);
    assert.equal(response.headers['content-security-policy'], SECURITY_HEADERS['content-security-policy']);
  }
});

test('/next and /next/* answer a relative 301 that copies the raw suffix and query byte for byte', async (t) => {
  const request = await fixture(t);
  for (const [path, location] of [
    ['/next', '/'], ['/next/', '/'], ['/next?x=1', '/?x=1'], ['/next/?x=1', '/?x=1'],
    ['/next/console/tenants', '/console/tenants'], ['/next/console/tenants?x=1', '/console/tenants?x=1'],
    ['/next/index.html?test=1', '/index.html?test=1'],
    ['/next/a%2Fb', '/a%2Fb'], ['/next/a%23b', '/a%23b'], ['/next/a%3Fb?x=1', '/a%3Fb?x=1'], ['/next/a%25b', '/a%25b'],
    ['/next/a%252Fb', '/a%252Fb'], ['/next/a//b', '/a//b'], ['/next/a?b=%2F&c=%23', '/a?b=%2F&c=%23'],
    ['/%6Eext/a%2Fb', '/a%2Fb'], ['/%6eext', '/'], ['/n%65xt/console?x=1', '/console?x=1'], ['/%6E%65%78%74/a%23b', '/a%23b'],
  ]) {
    const response = await request(path);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.location, location, path);
    assert.match(response.headers.location, /^\/(?!\/)/, `${path}: the Location is relative`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers[name], value, `${path} ${name}`);
  }
});

test('the /next redirect rejects scheme-relative, backslash and traversal targets with 400, encoded or not', async (t) => {
  const request = await fixture(t);
  for (const path of [
    '/next//evil.example', '/next/\\evil.example', '/next/%2F%2Fevil.example', '/next/%2Fevil.example', '/next/%5Cevil.example',
    '/next//', '/next///evil.example', '/%6Eext//evil.example', '/next/a%5Cb', '/next/a\\b',
    '/next/..', '/next/../', '/next/../index.html', '/next/%2e%2e/index.html', '/next/%2E%2E%2Findex.html', '/next/.%2e/x',
    '/next/a/../b', '/next/a%2F..%2Fb', '/next/assets/../../outside.html', '/next/..%5c..%5coutside.html',
    '/next/%00', '/next/%zz', '/next/a%', '/next/café', '/next/a b',
  ]) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.body, 'Bad request', path);
    assert.equal(response.headers.location, undefined, path);
    assert.ok(response.headers['content-security-policy'], path);
  }
});

test('assets are immutable, missing assets return 404 and traversal returns 400', async (t) => {
  const request = await fixture(t);
  const index = await request('/');
  const asset = await request('/assets/app.abc123.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.body, 'next();');
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(asset.headers['content-security-policy'], index.headers['content-security-policy']);
  for (const path of ['/assets/missing.js', '/assets/nested/missing.css']) {
    const missing = await request(path);
    assert.equal(missing.status, 404, path);
    assert.equal(missing.body, 'Not found', path);
    assert.equal(missing.headers['content-security-policy'], index.headers['content-security-policy']);
  }
  for (const path of ['/x/../y', '/assets/../../outside.html', '/%2e%2e/outside.html', '/x/%2e%2e/y', '/%00', '/%zz', '/..%5coutside.html']) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.body, 'Bad request', path);
  }
});

test('/v1 preserves upstream method, path, headers and body without added security headers', async (t) => {
  const request = await fixture(t);
  t.mock.method(http, 'request', (options, callback) => {
    assert.equal(options.host, 'gateway.test');
    assert.equal(options.port, 9081);
    const stream = new PassThrough();
    let body = '';
    stream.on('data', (chunk) => { body += chunk; });
    stream.on('finish', () => callback({
      statusCode: 209,
      headers: { 'content-type': 'application/json' },
      pipe(res) { res.end(JSON.stringify({ method: options.method, path: options.path, header: options.headers['x-test'], body })); }
    }));
    return stream;
  });
  const result = await request('/v1/projects?limit=1', { method: 'POST', headers: { 'x-test': 'preserved' }, body: 'payload' });
  assert.deepEqual(result, {
    status: 209, headers: { 'content-type': 'application/json' },
    body: '{"method":"POST","path":"/v1/projects?limit=1","header":"preserved","body":"payload"}'
  });
  // Even a /v1 path that names /next is proxied, never redirected.
  const nested = await request('/v1/next/x');
  assert.equal(nested.status, 209);
  assert.equal(nested.headers.location, undefined);
});

test('/healthz answers 200 ok, never the index, even when the bundle is absent', async (t) => {
  const request = await fixture(t, { absentIndex: true });
  assert.deepEqual(await request('/healthz'), { status: 200, headers: {}, body: 'ok' });
  const missing = await request('/login');
  assert.equal(missing.status, 404);
  assert.equal(missing.body, 'Not found');
});
