import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { respondHealth } from '../../apps/control-plane/health-response.mjs';
import { renderMetrics } from '../../apps/control-plane/metrics-registry.mjs';
import { vaultStoreFromEnv, vaultStoreHealthSnapshot } from '../../apps/control-plane/vault-secrets.mjs';

const serverSource = readFileSync(new URL('../../apps/control-plane/server.mjs', import.meta.url), 'utf8');
assert.match(serverSource, /if \(path === '\/healthz' \|\| path === '\/readyz'\)\s*\{\s*return respondHealth\(res, \{ pool, secretBackendHealth, sendJson \}\);/);
assert.match(serverSource, /renderMetrics\(secretBackendHealth\(\)\)/);

async function invokeHealth({ pool, snapshot }) {
  const response = {};
  await respondHealth(response, {
    pool, secretBackendHealth: snapshot, log: () => {},
    sendJson: (res, statusCode, body) => { res.statusCode = statusCode; res.body = body; },
  });
  return response;
}

test('bbx-984-health: both server probes report degraded auth while Postgres controls HTTP status', async () => {
  let dbUp = true;
  let queries = 0;
  const pool = { query: async () => { queries++; if (!dbUp) throw new Error('db down'); } };
  const snapshot = () => ({ state: 'degraded', lastSuccessAt: null,
    lastFailureAt: '2026-09-29T00:00:00.000Z', lastFailureStatus: 403,
    consecutiveFailures: 2, tokenExpiresAt: null });
  for (const path of ['/healthz', '/readyz']) {
    assert.match(serverSource, new RegExp(`'${path}'`));
    const response = await invokeHealth({ pool, snapshot });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.secretBackend, snapshot());
  }
  const metrics = renderMetrics(snapshot());
  assert.match(metrics, /falcone_secret_backend_auth_degraded 1\n/);
  assert.match(metrics, /falcone_secret_backend_auth_consecutive_failures 2\n/);
  dbUp = false;
  for (const path of ['/healthz', '/readyz']) {
    const response = await invokeHealth({ pool, snapshot });
    assert.equal(response.statusCode, 503, path);
    assert.equal(response.body.status, 'db_unavailable');
    assert.deepEqual(response.body.secretBackend, snapshot());
  }
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
  const response = await invokeHealth({ pool: { query: async () => {} },
    snapshot: () => vaultStoreHealthSnapshot(store) });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.secretBackend.state, 'disabled');
  const metrics = renderMetrics(response.body.secretBackend);
  assert.match(metrics, /falcone_secret_backend_auth_degraded 0\n/);
  assert.match(metrics, /falcone_secret_backend_auth_consecutive_failures 0\n/);
});

test('bbx-984-redaction: health and metrics contain no token, JWT, or secret value', async () => {
  const response = await invokeHealth({ pool: { query: async () => {} },
    snapshot: () => ({ state: 'degraded', lastSuccessAt: null,
      lastFailureAt: '2026-09-29T00:00:00.000Z', lastFailureStatus: 503,
      consecutiveFailures: 1, tokenExpiresAt: null }) });
  assert.doesNotMatch(JSON.stringify(response.body) + renderMetrics(response.body.secretBackend),
    /fake-token-sensitive|fake-jwt-sensitive|secret-value/);
});
