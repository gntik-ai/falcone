import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';

const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'";
const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'
};

// Mock only the HTTP transport boundary; requests exercise the shipped server callback
// and real filesystem. This also runs in sandboxes that prohibit listening sockets.
let instance = 0;
async function fixture(t, { absentDist = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'console-routing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  await writeFile(join(root, 'outside.html'), 'outside-root');
  if (!absentDist) {
    await mkdir(join(dist, 'assets'), { recursive: true });
    await writeFile(join(dist, 'index.html'), '<main>Next console</main>');
    await writeFile(join(dist, 'assets/app.abc123.js'), 'next();');
  }
  for (const [key, value] of Object.entries({ WEB_CONSOLE_STATIC_ROOT: dist, GATEWAY_UPSTREAM: 'gateway.test:9081' })) {
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

test('root, auth routes and deep links serve the next index with no-store and the unchanged CSP', async (t) => {
  const request = await fixture(t);
  for (const path of ['/', '/login', '/signup', '/console/tenants', '/console/flows/abc', '/index.html', '/nextish', '/legacyish']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, '<main>Next console</main>', path);
    assert.deepEqual(response.headers, { ...SECURITY_HEADERS, 'content-type': 'text/html', 'cache-control': 'no-store' }, path);
  }
});

test('/next permanently redirects to the same path at the root with a relative Location', async (t) => {
  const request = await fixture(t);
  for (const [path, location] of [
    ['/next', '/'],
    ['/next/', '/'],
    ['/next?x=1', '/?x=1'],
    ['/next/console/tenants', '/console/tenants'],
    ['/next/console/tenants?x=1', '/console/tenants?x=1'],
    ['/next/index.html?test=1', '/index.html?test=1'],
    // The suffix and the query are copied byte for byte: reserved escapes are never decoded.
    ['/next/a%2Fb', '/a%2Fb'],
    ['/next/a%23b', '/a%23b'],
    ['/next/a%3Fb?x=1', '/a%3Fb?x=1'],
    ['/next/a%25b', '/a%25b'],
    ['/next/a%2fb?q=%2F%3f', '/a%2fb?q=%2F%3f'],
    // A percent-encoded unreserved prefix normalises to /next (RFC 3986 6.2.2.2).
    ['/%6Eext/a%2Fb', '/a%2Fb'],
    ['/%6eext', '/'],
    ['/n%65%78t/console?x=1', '/console?x=1']
  ]) {
    const response = await request(path);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.location, location, path);
    assert.match(response.headers.location, /^\/(?![/\\])/, `${path} must stay a relative path`);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(response.headers[name], value, `${path} ${name}`);
  }
});

test('the /next redirect cannot become an open redirect or a path-confusion target', async (t) => {
  const request = await fixture(t);
  for (const path of ['/next//evil.example', '/next/\\evil.example', '/next///evil.example/x', '/%6Eext//evil.example']) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.headers.location, undefined, path);
  }
  // An encoded separator right after the prefix is not the /next prefix, and never serves a page.
  for (const path of ['/next%2Fa', '/next%2f']) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.location, undefined, path);
  }
});

test('no /next or /legacy path returns 200', async (t) => {
  const request = await fixture(t);
  for (const path of ['/next', '/next/', '/next/login', '/next/assets/app.abc123.js', '/legacy', '/legacy/', '/legacy/console/tenants', '/legacy/assets/app.js']) {
    const response = await request(path);
    assert.notEqual(response.status, 200, path);
    assert.ok(!response.body.includes('Next console'), path);
  }
  assert.equal((await request('/legacy')).status, 404);
  assert.equal((await request('/legacy/console/tenants')).status, 404);
});

test('/v1 reaches the upstream unmodified and without security headers, other API-looking paths stay static', async (t) => {
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
  assert.equal((await request('/v10/projects')).body, '<main>Next console</main>');
  const result = await request('/v1/projects?limit=1', { method: 'POST', headers: { 'x-test': 'preserved' }, body: 'payload' });
  assert.deepEqual(result, {
    status: 209, headers: { 'content-type': 'application/json' },
    body: '{"method":"POST","path":"/v1/projects?limit=1","header":"preserved","body":"payload"}'
  });
  const stub = await request('/v1/x', { body: 'x' });
  assert.equal(stub.status, 209);
  assert.equal(stub.headers['content-security-policy'], undefined);
});

test('assets are immutable and missing assets return 404 with security headers', async (t) => {
  const request = await fixture(t);
  const asset = await request('/assets/app.abc123.js');
  assert.equal(asset.status, 200);
  assert.equal(asset.body, 'next();');
  assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(asset.headers['content-security-policy'], CSP);
  const missing = await request('/assets/missing.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.body, 'Not found');
  assert.equal(missing.headers['content-security-policy'], CSP);
});

test('raw and encoded traversal and malformed paths return 400 before any redirect or file read', async (t) => {
  const request = await fixture(t);
  for (const path of [
    '/next/../index.html', '/next/%2e%2e/index.html', '/next/%2E%2E%2Findex.html',
    '/next/assets/../../outside.html', '/next/..%5c..%5coutside.html', '/next/a/..?x=1',
    '/%6Eext/%2e%2e/x', '/x/../y', '/assets/../../outside.html',
    '/%2e%2e/outside.html', '/next/%00', '/next/%zz', '/%00', '/%zz'
  ]) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.body, 'Bad request', path);
    assert.equal(response.headers.location, undefined, path);
    assert.ok(response.headers['content-security-policy']);
  }
});

test('/healthz answers ok and an absent bundle answers 404 instead of crashing the server', async (t) => {
  const request = await fixture(t, { absentDist: true });
  assert.deepEqual(await request('/healthz'), { status: 200, headers: {}, body: 'ok' });
  for (const path of ['/', '/login', '/console/tenants']) {
    const response = await request(path);
    assert.equal(response.status, 404, path);
    assert.equal(response.body, 'Not found');
  }
});
