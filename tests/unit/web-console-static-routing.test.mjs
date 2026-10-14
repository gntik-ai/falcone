import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

// Mock only the HTTP transport boundary; requests exercise the shipped server callback
// and real filesystem. This also runs in sandboxes that prohibit listening sockets.
let instance = 0;
async function fixture(t, { absentNext = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'console-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = join(root, 'dist');
  const next = join(root, 'dist-next');
  await mkdir(join(legacy, 'assets'), { recursive: true });
  await writeFile(join(legacy, 'index.html'), '<main>Legacy console</main>');
  await writeFile(join(legacy, 'assets/app.js'), 'legacy();');
  await writeFile(join(root, 'outside.html'), 'outside-root');
  if (!absentNext) {
    await mkdir(join(next, 'assets'), { recursive: true });
    await writeFile(join(next, 'index.html'), '<main>Next console</main>');
    await writeFile(join(next, 'assets/app.abc123.js'), 'next();');
  }
  for (const [key, value] of Object.entries({ WEB_CONSOLE_STATIC_ROOT: legacy, WEB_CONSOLE_NEXT_STATIC_ROOT: next, GATEWAY_UPSTREAM: 'gateway.test:9081' })) {
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
      end(body) { response.body = Buffer.from(body).toString(); resolveEnd(); }
    });
    await ended;
    return response;
  };
}

test('next shell and deep links return their own HTML with unchanged legacy security headers', async (t) => {
  const request = await fixture(t);
  const legacy = await request('/');
  assert.equal(legacy.body, '<main>Legacy console</main>');
  assert.deepEqual(legacy.headers, {
    'content-security-policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'",
    'x-frame-options': 'DENY',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'content-type': 'text/html', 'cache-control': 'no-store'
  });
  for (const path of ['/next', '/next/', '/next/console/tenants', '/next/index.html?test=1']) {
    const next = await request(path);
    assert.equal(next.status, 200, path);
    assert.equal(next.body, '<main>Next console</main>', path);
    assert.deepEqual(next.headers, legacy.headers);
    assert.equal(next.headers['content-type'], 'text/html');
    assert.equal(next.headers['cache-control'], 'no-store');
  }
});

test('next API-looking paths stay static while /v1 preserves upstream method, path, headers and body', async (t) => {
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
  assert.equal((await request('/next/v1/projects')).body, '<main>Next console</main>');
  const result = await request('/v1/projects?limit=1', { method: 'POST', headers: { 'x-test': 'preserved' }, body: 'payload' });
  assert.deepEqual(result, {
    status: 209, headers: { 'content-type': 'application/json' },
    body: '{"method":"POST","path":"/v1/projects?limit=1","header":"preserved","body":"payload"}'
  });
});

test('next assets are immutable and missing assets return 404 with security headers', async (t) => {
  const request = await fixture(t);
  const legacy = await request('/assets/app.js');
  const next = await request('/next/assets/app.abc123.js');
  assert.equal(next.status, 200);
  assert.equal(next.body, 'next();');
  assert.deepEqual(next.headers, legacy.headers);
  assert.equal(next.headers['cache-control'], 'public, max-age=31536000, immutable');
  const missing = await request('/next/assets/missing.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.body, 'Not found');
  assert.equal(missing.headers['content-security-policy'], next.headers['content-security-policy']);
});

test('raw and encoded traversal and malformed paths cannot escape either static root', async (t) => {
  const request = await fixture(t);
  for (const path of [
    '/next/../index.html', '/next/%2e%2e/index.html', '/next/%2E%2E%2Findex.html',
    '/next/assets/../../outside.html', '/next/..%5c..%5coutside.html',
    '/%2e%2e/outside.html', '/next/%00', '/next/%zz'
  ]) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.body, 'Bad request', path);
    assert.ok(response.headers['content-security-policy']);
  }
});

test('an absent next bundle returns 404 while legacy fallback, assets and health remain available', async (t) => {
  const request = await fixture(t, { absentNext: true });
  for (const path of ['/next', '/next/', '/next/console/tenants', '/next/assets/app.js']) {
    const next = await request(path);
    assert.equal(next.status, 404, path);
    assert.equal(next.body, 'Not found');
  }
  for (const path of ['/', '/index.html', '/login', '/console/tenants', '/nextish']) {
    assert.deepEqual(await request(path), await request('/'), path);
  }
  assert.equal((await request('/assets/app.js')).body, 'legacy();');
  assert.deepEqual(await request('/healthz'), { status: 200, headers: {}, body: 'ok' });
});
