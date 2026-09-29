import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKubernetesAuthTokenProvider, createVaultKvClient } from '../../apps/control-plane/vault-secrets.mjs';

function authHarness(fetchImpl) {
  let time = 0;
  const timers = [];
  const logs = [];
  const dir = mkdtempSync(join(tmpdir(), 'falcone-bao-auth-'));
  const jwtPath = join(dir, 'jwt');
  writeFileSync(jwtPath, 'fake-jwt-sensitive');
  const provider = createKubernetesAuthTokenProvider({ addr: 'http://bao', role: 'workspace-secrets-role',
    namespace: 'team-1', serviceAccountJwtPath: jwtPath, fetchImpl,
    now: () => time, setTimeoutImpl: (fn, delay) => {
      const handle = { at: time + delay, fn, cleared: false, unref() {} };
      timers.push(handle);
      return handle;
    }, clearTimeoutImpl: (handle) => { handle.cleared = true; },
    random: () => 0, log: (line) => logs.push(line) });
  return { provider, logs, timers, advance: async (ms) => {
    time += ms;
    for (const t of [...timers]) if (!t.cleared && t.at <= time) {
      t.cleared = true;
      t.fn();
      await new Promise(setImmediate);
    }
  }, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('bbx-984-renew: eager login renews after half the lease without another login', async () => {
  let logins = 0; let renewals = 0; let renewHeaders;
  const h = authHarness(async (url, init) => {
    if (url.endsWith('/renew-self')) {
      renewals++; renewHeaders = init.headers;
      return { ok: true, json: async () => ({ auth: { lease_duration: 100, renewable: true } }) };
    }
    logins++;
    return { ok: true, json: async () => ({ auth: { client_token: 'fake-token-sensitive', lease_duration: 100, renewable: true } }) };
  });
  try {
    assert.equal(await h.provider(), 'fake-token-sensitive');
    await h.advance(55_100);
    assert.equal(await h.provider(), 'fake-token-sensitive');
    assert.equal(logins, 1);
    assert.equal(renewals, 1);
    assert.equal(renewHeaders['x-vault-token'], 'fake-token-sensitive');
    assert.equal(renewHeaders['x-vault-namespace'], 'team-1');
    assert.equal(h.provider.getHealthSnapshot().state, 'ok');
  } finally { h.cleanup(); }
});

test('bbx-984-single-flight: concurrent callers share the eager startup login', async () => {
  let logins = 0; let release;
  const h = authHarness(async () => {
    logins++;
    await new Promise((resolve) => { release = resolve; });
    return { ok: true, json: async () => ({ auth: {
      client_token: 'token-1', lease_duration: 100, renewable: true,
    } }) };
  });
  try {
    const callers = [h.provider(), h.provider(), h.provider()];
    await new Promise(setImmediate);
    assert.equal(logins, 1);
    release();
    assert.deepEqual(await Promise.all(callers), ['token-1', 'token-1', 'token-1']);
  } finally { h.cleanup(); }
});

test('bbx-984-fallback: failed renewal re-logs in once; concurrent callers share it', async () => {
  let logins = 0; let release;
  const h = authHarness(async (url) => {
    if (url.endsWith('/renew-self')) return { ok: false, status: 403 };
    logins++;
    if (logins === 2) await new Promise((resolve) => { release = resolve; });
    return { ok: true, json: async () => ({ auth: { client_token: `token-${logins}`, lease_duration: 100, renewable: true } }) };
  });
  try {
    await h.provider();
    const advancing = h.advance(55_100);
    await new Promise(setImmediate);
    const callers = [h.provider(), h.provider()];
    release();
    await advancing;
    assert.deepEqual(await Promise.all(callers), ['token-1', 'token-1'],
      'a valid token remains usable while background re-login is in flight');
    await new Promise(setImmediate);
    assert.equal(await h.provider(), 'token-2');
    assert.equal(logins, 2);
    assert.equal(h.provider.getHealthSnapshot().consecutiveFailures, 0);
    assert.equal(h.provider.getHealthSnapshot().state, 'ok');
    assert.equal(h.logs.length, 1, 'the recovered renewal failure remains observable');
    assert.match(h.logs[0], /secret_backend_auth_renewal_failure/);
  } finally { h.cleanup(); }
});

test('bbx-984-failure: startup denial degrades, bounded backoff recovers and redacts credentials', async () => {
  let attempts = 0;
  const h = authHarness(async () => {
    attempts++;
    if (attempts === 1) return { ok: false, status: 403 };
    return { ok: true, json: async () => ({ auth: { client_token: 'fake-token-sensitive', lease_duration: 100, renewable: true } }) };
  });
  try {
    await assert.rejects(h.provider(), /HTTP 403/);
    assert.equal(h.provider.getHealthSnapshot().state, 'degraded');
    assert.equal(h.provider.getHealthSnapshot().lastFailureStatus, 403);
    assert.equal(h.logs.length, 1);
    assert.match(h.logs[0], /workspace-secrets-role/);
    assert.ok(h.timers.some((t) => !t.cleared && t.at >= 500 && t.at <= 1000));
    await Promise.all(Array.from({ length: 5 }, () => assert.rejects(h.provider(), /HTTP 403/)));
    assert.equal(attempts, 1, 'requests cannot bypass the retry deadline');
    await h.advance(1000);
    assert.equal(await h.provider(), 'fake-token-sensitive');
    assert.equal(h.provider.getHealthSnapshot().state, 'ok');
    assert.equal(h.provider.getHealthSnapshot().consecutiveFailures, 0);
    assert.match(h.logs[1], /secret_backend_auth_recovered/);
    assert.doesNotMatch(JSON.stringify({ logs: h.logs, health: h.provider.getHealthSnapshot() }), /fake-jwt-sensitive|fake-token-sensitive/);
  } finally { h.cleanup(); }
});

test('bbx-984-kv-403: provider token is replaced and the KV request retries exactly once', async () => {
  let logins = 0; let kv = 0;
  const fakeFetch = async (url, init) => {
    if (url.endsWith('/login')) return { ok: true, json: async () => ({ auth: {
      client_token: `token-${++logins}`, lease_duration: 100, renewable: true,
    } }) };
    kv++;
    if (init.headers['x-vault-token'] === 'token-1') return { status: 403, ok: false };
    return { status: 200, ok: true, json: async () => ({ data: { data: { value: 'secret-value' }, metadata: { version: 1 } } }) };
  };
  const h = authHarness(fakeFetch);
  try {
    const client = createVaultKvClient({ addr: 'http://bao', tokenProvider: h.provider,
      fetchImpl: fakeFetch });
    assert.equal((await client.readSecret('t/w/k')).data.value, 'secret-value');
    assert.equal(logins, 2);
    assert.equal(kv, 2);
  } finally { h.cleanup(); }
});

test('bbx-984-renew-and-login-fail: degraded state persists and retry is bounded', async () => {
  let logins = 0;
  const h = authHarness(async (url) => {
    if (url.endsWith('/renew-self')) return { ok: false, status: 403 };
    if (++logins > 1) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ auth: {
      client_token: 'fake-token-sensitive', lease_duration: 100, renewable: true,
    } }) };
  });
  try {
    await h.provider();
    await h.advance(55_100);
    const health = h.provider.getHealthSnapshot();
    assert.equal(health.state, 'degraded');
    assert.equal(health.lastFailureStatus, 503);
    assert.equal(health.consecutiveFailures, 1);
    assert.equal(h.logs.length, 2, 'renewal failure and transition to degraded are logged');
    assert.ok(h.timers.some((t) => !t.cleared && t.at >= 55_100 + 500 && t.at <= 55_100 + 1000));
    assert.doesNotMatch(JSON.stringify({ health, logs: h.logs }), /fake-token-sensitive|fake-jwt-sensitive/);
  } finally { h.cleanup(); }
});

test('bbx-984-second-kv-403: one retry still surfaces the original KV error', async () => {
  let logins = 0; let kv = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/login')) return { ok: true, json: async () => ({ auth: {
      client_token: `token-${++logins}`, lease_duration: 100, renewable: true,
    } }) };
    kv++;
    return { status: 403, ok: false };
  };
  const h = authHarness(fetchImpl);
  try {
    const client = createVaultKvClient({ addr: 'http://bao', tokenProvider: h.provider, fetchImpl });
    await assert.rejects(client.readSecret('t/w/k'), /vault read t\/w\/k -> HTTP 403/);
    assert.equal(logins, 2);
    assert.equal(kv, 2);
  } finally { h.cleanup(); }
});

test('bbx-984-policy-403: repeated policy denials do not mint a new token per request', async () => {
  let logins = 0; let kv = 0;
  const fetchImpl = async (url) => {
    if (url.endsWith('/login')) return { ok: true, json: async () => ({ auth: {
      client_token: `token-${++logins}`, lease_duration: 3600, renewable: true,
    } }) };
    kv++;
    return { status: 403, ok: false };
  };
  const h = authHarness(fetchImpl);
  try {
    const client = createVaultKvClient({ addr: 'http://bao', tokenProvider: h.provider, fetchImpl });
    await assert.rejects(client.readSecret('t/w/k'), /HTTP 403/);
    for (let i = 0; i < 5; i++) await assert.rejects(client.readSecret('t/w/k'), /HTTP 403/);
    assert.equal(logins, 2, 'policy denials cannot mint a token for every request');
    assert.equal(kv, 7, 'later requests surface the first 403 without another retry');
    await h.advance(60_000);
    await assert.rejects(client.readSecret('t/w/k'), /HTTP 403/);
    assert.equal(logins, 3, 'the bounded cooldown eventually allows a fresh login');
  } finally { h.cleanup(); }
});

test('bbx-984-backoff-invalidate: a KV 403 cannot cancel the background re-login retry', async () => {
  let logins = 0;
  const h = authHarness(async (url) => {
    if (url.endsWith('/renew-self')) return { ok: false, status: 403 };
    logins++;
    if (logins === 2) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ auth: {
      client_token: `token-${logins}`, lease_duration: 100, renewable: true,
    } }) };
  });
  try {
    assert.equal(await h.provider(), 'token-1');
    await h.advance(55_100);
    assert.equal(h.provider.getHealthSnapshot().state, 'degraded');
    assert.equal(await h.provider(), 'token-1', 'a failed background attempt cannot block a valid token');
    await assert.rejects(h.provider.invalidate('token-1'), /HTTP 503/);
    assert.equal(h.provider.getHealthSnapshot().tokenExpiresAt, null);
    assert.equal(h.timers.filter((t) => !t.cleared).length, 1, 'backoff timer remains armed');
    await h.advance(1000);
    assert.equal(await h.provider(), 'token-3');
    assert.equal(h.provider.getHealthSnapshot().state, 'ok');
    assert.equal(logins, 3);
  } finally { h.cleanup(); }
});

test('bbx-984-auth-timeout: a hung renewal has a deadline and does not block valid-token reads', async () => {
  let logins = 0;
  const h = authHarness(async (url) => {
    if (url.endsWith('/renew-self')) return new Promise(() => {});
    return { ok: true, json: async () => ({ auth: {
      client_token: `token-${++logins}`, lease_duration: 100, renewable: true,
    } }) };
  });
  try {
    await h.provider();
    await h.advance(55_100);
    assert.equal(await h.provider(), 'token-1');
    await h.advance(10_000);
    assert.equal(await h.provider(), 'token-2');
    assert.equal(logins, 2);
    assert.equal(h.provider.getHealthSnapshot().state, 'ok');
  } finally { h.cleanup(); }
});

test('bbx-984-long-lease: timers are capped without renewing before half the lease', async () => {
  let renewals = 0;
  const leaseSeconds = 50 * 24 * 60 * 60;
  const h = authHarness(async (url) => {
    if (url.endsWith('/renew-self')) renewals++;
    return { ok: true, json: async () => ({ auth: {
      client_token: 'token', lease_duration: leaseSeconds, renewable: true,
    } }) };
  });
  try {
    await h.provider();
    await h.advance(2_147_483_647);
    assert.equal(renewals, 0);
    assert.equal(h.timers.filter((t) => !t.cleared).length, 1);
    await h.advance(3 * 24 * 60 * 60 * 1000);
    assert.equal(renewals, 1);
  } finally { h.cleanup(); }
});
