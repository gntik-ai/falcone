// bbx-flows-act-ssrf
//
// Black-box SSRF coverage for the http.request activity (change:
// add-flows-activity-catalog / #360, tasks 10.1). Mirrors
// tests/blackbox/webhook-ssrf-guard.test.mjs but drives the PUBLIC activity surface
// (resolveSsrfSafe + httpRequest). No live infra; an injected resolver simulates DNS.
// Fixtures use documentation / RFC-reserved addresses only — no provider-shaped secrets.
//
// Scenarios:
//   bbx-flows-act-ssrf-01: link-local 169.254.169.254 → SSRF_BLOCKED, no http call
//   bbx-flows-act-ssrf-02: decimal-encoded 2852039166 (=169.254.169.254) → SSRF_BLOCKED
//   bbx-flows-act-ssrf-03: RFC-1918 / loopback / 0.0.0.0 literals → SSRF_BLOCKED
//   bbx-flows-act-ssrf-04: DNS name resolving to a blocked IP → SSRF_BLOCKED (rebinding)
//   bbx-flows-act-ssrf-05: DNS resolution failure → SSRF_BLOCKED (fail-closed)
//   bbx-flows-act-ssrf-06: legitimate public hostname → success, http called
//   bbx-flows-act-ssrf-07: non-http scheme rejected
//   bbx-flows-act-ssrf-08: credentials are never forwarded to the external target
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveSsrfSafe } from '../../services/workflow-worker/src/activities/ssrf.mjs';
import { httpRequest } from '../../services/workflow-worker/src/activities/http-request.mjs';

const tenant = { tenantId: 't1', workspaceId: 'w1' };

async function expectBlocked(url, resolver) {
  let httpCalled = false;
  try {
    await httpRequest(
      { params: { url }, tenant },
      { resolver, http: async () => { httpCalled = true; return { status: 200 }; } },
    );
    assert.fail(`expected SSRF_BLOCKED for ${url}`);
  } catch (err) {
    assert.equal(err.type, 'SSRF_BLOCKED', `expected SSRF_BLOCKED, got ${err.type}: ${err.message}`);
    assert.equal(err.nonRetryable, true, 'SSRF must be non-retryable');
    assert.equal(httpCalled, false, 'no outbound HTTP connection must be opened');
  }
}

test('bbx-flows-act-ssrf-01: link-local 169.254.169.254 → SSRF_BLOCKED', async () => {
  await expectBlocked('https://169.254.169.254/latest/meta-data/');
});

test('bbx-flows-act-ssrf-02: decimal-encoded 2852039166 → SSRF_BLOCKED', async () => {
  await expectBlocked('https://2852039166/path');
});

test('bbx-flows-act-ssrf-03: private/loopback/unspecified literals → SSRF_BLOCKED', async () => {
  for (const url of [
    'https://10.0.0.5/x',
    'https://192.168.1.10/x',
    'https://172.16.5.5/x',
    'https://127.0.0.1/x',
    'https://0.0.0.0/x',
    'http://localhost/x',
    'https://[::1]/x',
    'https://[fe80::1]/x',
  ]) {
    await expectBlocked(url);
  }
});

test('bbx-flows-act-ssrf-04: DNS rebinding — hostname resolves to blocked IP → SSRF_BLOCKED', async () => {
  await expectBlocked('https://metadata.evil.example/hook', async () => ['169.254.169.254']);
});

test('bbx-flows-act-ssrf-05: DNS resolution failure → SSRF_BLOCKED (fail-closed)', async () => {
  await expectBlocked('https://does-not-exist.invalid/hook', async () => { throw new Error('ENOTFOUND'); });
});

test('bbx-flows-act-ssrf-06: legitimate public hostname → success', async () => {
  let httpCalled = false;
  const out = await httpRequest(
    { params: { url: 'https://example.com/ok', method: 'GET' }, tenant },
    {
      resolver: async () => ['93.184.216.34'], // public documentation IP
      http: async () => { httpCalled = true; return { status: 200, headers: new Map(), text: async () => 'ok' }; },
    },
  );
  assert.equal(out.status, 'success');
  assert.equal(out.httpStatus, 200);
  assert.equal(httpCalled, true);
});

test('bbx-flows-act-ssrf-07: non-http scheme rejected', async () => {
  await assert.rejects(
    () => resolveSsrfSafe('file:///etc/passwd'),
    (err) => err.type === 'SSRF_BLOCKED',
  );
  await assert.rejects(
    () => resolveSsrfSafe('gopher://203.0.113.10/'),
    (err) => err.type === 'SSRF_BLOCKED',
  );
});

test('bbx-flows-act-ssrf-08: tenant credentials never forwarded to the external target', async () => {
  let forwardedAuth;
  await httpRequest(
    { params: { url: 'https://example.com/x', headers: { authorization: 'Bearer should-not-leak', cookie: 'sid=should-not-leak' } }, tenant },
    {
      resolver: async () => ['93.184.216.34'],
      http: async (_url, opts) => { forwardedAuth = { auth: opts.headers.authorization, cookie: opts.headers.cookie }; return { status: 200, headers: new Map(), text: async () => '' }; },
    },
  );
  assert.equal(forwardedAuth.auth, undefined, 'authorization must be stripped');
  assert.equal(forwardedAuth.cookie, undefined, 'cookie must be stripped');
});

test('bbx-flows-act-ssrf-pin: resolved address is pinned for the dispatcher', async () => {
  let pinnedAddress = null;
  await httpRequest(
    { params: { url: 'https://example.com/x' }, tenant },
    {
      resolver: async () => [{ address: '203.0.113.10', family: 4 }],
      dispatcherFactory: async ({ address }) => { pinnedAddress = address; return { fake: true }; },
      http: async () => ({ status: 200, headers: new Map(), text: async () => '' }),
    },
  );
  assert.equal(pinnedAddress, '203.0.113.10', 'dispatcher must be pinned to the validated IP');
});
