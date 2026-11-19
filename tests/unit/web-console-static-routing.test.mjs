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
  for (const [key, value] of Object.entries({ WEB_CONSOLE_STATIC_ROOT: next, WEB_CONSOLE_NEXT_STATIC_ROOT: legacy, GATEWAY_UPSTREAM: 'gateway.test:9081' })) {
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
      end(body = '') { response.body = Buffer.from(body).toString(); resolveEnd(); }
    });
    await ended;
    return response;
  };
}

test('the root serves next deep links and old prefixes cannot serve a bundle', async (t) => {
  const request = await fixture(t);
  const root = await request('/');
  assert.equal(root.body, '<main>Next console</main>');
  for (const path of ['/', '/login', '/signup', '/console/tenants', '/console/flows/abc']) {
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.body, '<main>Next console</main>', path);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['content-security-policy'], CSP);
  }
  for (const [path, location] of redirectCases) {
    const response = await request(path);
    assert.equal(response.status, 301, path);
    assert.equal(response.headers.location, location, path);
    for (const name of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy']) {
      assert.equal(response.headers[name], root.headers[name], path + ' ' + name);
    }
  }
  for (const path of ['/legacy', '/legacy/', '/legacy/login', '/next%2Fconsole', '/%6Eext%2fconsole']) assert.equal((await request(path)).status, 404, path);
});

const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; form-action 'self'";
const redirectCases = [
  ['/next', '/'], ['/next/', '/'], ['/next?x=1', '/?x=1'],
  ['/next/console/tenants?x=1', '/console/tenants?x=1'],
  ['/next/a%2Fb', '/a%2Fb'], ['/next/a%23b', '/a%23b'],
  ['/next/a%3Fb?x=1', '/a%3Fb?x=1'], ['/%6Eext/a%2Fb', '/a%2Fb'],
  ['/n%65%78%74/a%25b?x=%23', '/a%25b?x=%23'],
];

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
  assert.equal((await request('/next/v1/projects')).headers.location, '/v1/projects');
  const result = await request('/v1/projects?limit=1', { method: 'POST', headers: { 'x-test': 'preserved' }, body: 'payload' });
  assert.deepEqual(result, {
    status: 209, headers: { 'content-type': 'application/json' },
    body: '{"method":"POST","path":"/v1/projects?limit=1","header":"preserved","body":"payload"}'
  });
});

test('next assets are immutable and missing assets return 404 with security headers', async (t) => {
  const request = await fixture(t);
  const next = await request('/assets/app.abc123.js');
  assert.equal(next.status, 200);
  assert.equal(next.body, 'next();');
  assert.equal(next.headers['cache-control'], 'public, max-age=31536000, immutable');
  const missing = await request('/assets/missing.js');
  assert.equal(missing.status, 404);
  assert.equal(missing.body, 'Not found');
  assert.equal(missing.headers['content-security-policy'], next.headers['content-security-policy']);
});

test('raw and encoded traversal and malformed paths cannot escape either static root', async (t) => {
  const request = await fixture(t);
  for (const path of [
    '/next/../index.html', '/next/%2e%2e/index.html', '/next/%2E%2E%2Findex.html',
    '/next/assets/../../outside.html', '/next/..%5c..%5coutside.html',
    '/%2e%2e/outside.html', '/next/%00', '/next/%zz', '/x/../y', '/%6Eext/%2e%2e/x', '/next//external.test/x'
  ]) {
    const response = await request(path);
    assert.equal(response.status, 400, path);
    assert.equal(response.body, 'Bad request', path);
    assert.ok(response.headers['content-security-policy']);
  }
});

test('a missing next bundle fails closed and never falls back to legacy', async (t) => {
  const request = await fixture(t, { absentNext: true });
  for (const path of ['/', '/index.html', '/login', '/console/tenants', '/assets/app.js']) {
    assert.equal((await request(path)).status, 404, path);
  }
  assert.deepEqual(await request('/healthz'), { status: 200, headers: {}, body: 'ok' });
});
