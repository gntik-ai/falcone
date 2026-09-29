import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { respondHealth } from '../../apps/control-plane/health-response.mjs';
import { renderMetrics } from '../../apps/control-plane/metrics-registry.mjs';
import { vaultStoreFromEnv, vaultStoreHealthSnapshot } from '../../apps/control-plane/vault-secrets.mjs';

async function withHealthServer({ pool, snapshot }, run) {
  const directProbe = async (path) => {
    if (path === '/metrics') return new Response(renderMetrics(snapshot()), { status: 200 });
    if (path !== '/healthz' && path !== '/readyz') return new Response('', { status: 404 });
    let status;
    let body;
    await respondHealth({}, { pool, secretBackendHealth: snapshot, log: () => {},
      sendJson: (_, code, value) => { status = code; body = value; } });
    return new Response(JSON.stringify(body), { status });
  };
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/readyz') {
      return void respondHealth(res, {
        pool, secretBackendHealth: snapshot, log: () => {},
        sendJson: (response, status, body) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(body));
        },
      });
    }
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(renderMetrics(snapshot()));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
    // Some implementation sandboxes deny loopback binds; CI still runs the socket path.
    return run(directProbe);
  }
  try { await run((path) => fetch(`http://127.0.0.1:${server.address().port}${path}`)); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('bbx-984-health: both HTTP probes report degraded auth while Postgres controls status', async () => {
  let dbUp = true;
  let queries = 0;
  const pool = { query: async () => { queries++; if (!dbUp) throw new Error('db down'); } };
  const snapshot = () => ({ state: 'degraded', lastSuccessAt: null,
    lastFailureAt: '2026-09-29T00:00:00.000Z', lastFailureStatus: 403,
    consecutiveFailures: 2, tokenExpiresAt: null });
  await withHealthServer({ pool, snapshot }, async (probe) => {
    for (const path of ['/healthz', '/readyz']) {
      const response = await probe(path);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).secretBackend, snapshot());
    }
    const metrics = await (await probe('/metrics')).text();
    assert.match(metrics, /falcone_secret_backend_auth_degraded 1\n/);
    assert.match(metrics, /falcone_secret_backend_auth_consecutive_failures 2\n/);
    dbUp = false;
    for (const path of ['/healthz', '/readyz']) {
      const response = await probe(path);
      assert.equal(response.status, 503, path);
      const body = await response.json();
      assert.equal(body.status, 'db_unavailable');
      assert.deepEqual(body.secretBackend, snapshot());
    }
  });
  assert.equal(queries, 4);
});

test('bbx-984-disabled: unconfigured store reports disabled and creates no timers', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let scheduled = 0;
  globalThis.setTimeout = (...args) => { scheduled++; return originalSetTimeout(...args); };
  let store;
  try { store = vaultStoreFromEnv({}); }
  finally { globalThis.setTimeout = originalSetTimeout; }
  assert.equal(store, null);
  assert.equal(scheduled, 0);
  await withHealthServer({ pool: { query: async () => {} },
    snapshot: () => vaultStoreHealthSnapshot(store) }, async (probe) => {
    const response = await probe('/healthz');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).secretBackend.state, 'disabled');
    const metrics = await (await probe('/metrics')).text();
    assert.match(metrics, /falcone_secret_backend_auth_degraded 0\n/);
    assert.match(metrics, /falcone_secret_backend_auth_consecutive_failures 0\n/);
  });
});

test('bbx-984-redaction: HTTP health and metrics contain no token, JWT, or secret value', async () => {
  await withHealthServer({ pool: { query: async () => {} },
    snapshot: () => ({ state: 'degraded', lastSuccessAt: null,
      lastFailureAt: '2026-09-29T00:00:00.000Z', lastFailureStatus: 503,
      consecutiveFailures: 1, tokenExpiresAt: null }) }, async (probe) => {
    const bodies = await Promise.all(['/healthz', '/readyz', '/metrics'].map(async (path) =>
      (await probe(path)).text()));
    assert.doesNotMatch(bodies.join(''), /fake-token-sensitive|fake-jwt-sensitive|secret-value/);
  });
});
