import test from 'node:test';
import assert from 'node:assert/strict';
import { __setSecretRotationTestHooks } from '../../apps/control-plane/secret-rotation-deps.mjs';
import { startMetricsServer } from './helpers/control-plane-metrics-server.mjs';

const prefix = '/v1/platform/secrets';
function recordingPool() {
  return { queries: [], async connect() { return this; }, release() {}, async query(sql, values) {
    this.queries.push({ sql, values });
    return { rows: [] };
  } };
}

test('invalid secret names and versions are rejected before any database access', async () => {
  const pool = recordingPool();
  const server = await startMetricsServer({ databasePool: pool });
  const bearer = server.token({ iss: 'http://fixture/realms/platform', realm_access: { roles: ['superadmin'] } });
  for (const path of ['platform/app%20password/history', 'platform/.hidden/history', 'unknown/app-password/history', 'platform/app-password/consumer-status?vaultVersion=abc', 'platform/app-password/consumer-status?vaultVersion=0']) {
    pool.queries.length = 0;
    const response = await server.request(`${prefix}/${path}`, { bearer });
    assert.equal(response.status, 400, path);
    assert.equal(JSON.parse(response.body).error.code, path.includes('vaultVersion') ? 'INVALID_VAULT_VERSION' : 'INVALID_SECRET_PATH');
    assert.deepEqual(pool.queries, []);
  }
});

async function fixture(t, options = {}) {
  const kv = [], published = [], patches = [], logs = [];
  const pool = recordingPool();
  pool.query = async function(sql, values = []) {
    this.queries.push({ sql, values });
    if (sql.includes('http_idempotency_records')) return { rows: sql.startsWith('INSERT') ? [{ reservation_id: values[3] }] : [] };
    if (sql.includes('secret_metadata')) return { rows: options.owner ? [options.owner] : [] };
    const tenant_id = options.rowTenant ?? (values[0]?.startsWith?.('tenant/') ? values[0].split('/')[1] : null);
    const active = { id: 'active', vault_version: 2, tenant_id };
    const grace = { id: 'grace', vault_version: 1, tenant_id, grace_expires_at: '2026-10-16T20:00:00.000Z' };
    if (sql.startsWith('SELECT') && sql.includes('secret_version_states')) {
      if (sql.includes('vault_version=$2')) return { rows: values[1] === 1 ? [grace] : values[1] === 2 ? [active] : [] };
      if (sql.includes("state='active'")) return { rows: options.noActive ? [] : [active] };
      if (sql.includes("state='grace'")) return { rows: options.noGrace ? [] : [grace] };
    }
    if (sql.startsWith('UPDATE secret_version_states')) return { rows: [sql.includes("state='grace'") ? grace : active] };
    if (sql.startsWith('INSERT INTO secret_version_states')) return { rows: [{ id: 'new' }] };
    if (sql.includes('SELECT * FROM secret_consumer_registry')) return { rows: [{ consumer_id: 'app', reload_mechanism: 'eso_annotation', eso_external_secret_name: 'app-password', consumer_namespace: 'apps' }] };
    if (sql.startsWith('INSERT INTO secret_propagation_events')) return { rows: [{ requested_at: '2026-10-16T19:30:00.000Z' }] };
    if (sql.includes('FROM secret_rotation_events')) {
      assert.match(sql, /ORDER BY occurred_at DESC LIMIT \$2 OFFSET \$3/);
      return { rows: [3, 2, 1].slice(values[2], values[2] + values[1]).map(n => ({ event_type: 'initiated', actor_id: 'actor', occurred_at: `2026-10-16T0${n}:00:00Z`, __total: 3 })) };
    }
    if (sql.includes('secret_rotation_events') || sql.includes('secret_propagation_events') || sql.includes('scope_enforcement_denials') || ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] };
    throw Error(`Unexpected SQL: ${sql}`);
  };
  __setSecretRotationTestHooks({ env: { BAO_ADDR: 'http://bao', BAO_TOKEN: 'fixture-token' },
    fetchImpl: async (url, init) => {
      kv.push({ url, method: init.method, body: JSON.parse(init.body) });
      return options.kvFail ? new Response('', { status: 500 }) : Response.json({ data: { version: 7 } });
    },
    getProducer: async () => ({ async send(record) {
      assert.ok(pool.queries.some(q => q.sql === 'COMMIT'));
      published.push(record);
      if (options.sideEffectFail) throw Object.assign(Error('fixture-value private-justification'), { code: 'KAFKA_DOWN' });
    } }),
    getKubernetesApi: async () => ({ async patchExternalSecret(...args) {
      assert.ok(pool.queries.some(q => q.sql === 'COMMIT'));
      patches.push(args);
      if (options.sideEffectFail) throw Object.assign(Error('fixture-value private-justification'), { code: 'KUBE_DOWN' });
    } }), logger: { error: record => logs.push(record) },
  });
  t.after(() => __setSecretRotationTestHooks());
  const server = await startMetricsServer({ databasePool: pool });
  const bearer = server.token({ iss: 'http://fixture/realms/platform', realm_access: { roles: ['superadmin'] } });
  return { pool, kv, published, patches, logs, server, bearer,
    async request(path, init = {}) { const r = await server.request(`${prefix}/${path}`, { bearer, ...init }); return { status: r.status, body: JSON.parse(r.body) }; } };
}

test('rotate validates the new value before database or KV access', async t => {
  const f = await fixture(t);
  for (const newValue of ['', null, 42, undefined]) {
    const response = await f.request('platform/app-password/rotate', { method: 'POST', body: { newValue, gracePeriodSeconds: 1800 } });
    assert.deepEqual(response, { status: 422, body: { error: { code: 'INVALID_NEW_VALUE', status: 422 } } });
  }
  assert.deepEqual(f.kv, []);
  assert.deepEqual(f.pool.queries, []);
});

test('rotate commits the KV version and requests consumer reloads', async t => {
  const f = await fixture(t);
  const response = await f.request('platform/app-password/rotate', { method: 'POST', body: { newValue: 'fixture-value', justification: 'private-justification', gracePeriodSeconds: 1800 } });
  assert.equal(response.status, 200);
  assert.match(response.body.rotationId, /^[a-f0-9-]{36}$/);
  assert.deepEqual({ ...response.body, rotationId: undefined }, { rotationId: undefined, vaultVersionNew: 7, vaultVersionOld: 2, gracePeriodSeconds: 1800, graceExpiresAt: '2026-10-16T20:00:00.000Z' });
  assert.deepEqual(f.kv, [{ method: 'POST', url: 'http://bao/v1/secret/data/platform/app-password', body: { data: { value: 'fixture-value' } } }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.published.map(p => p.topic).sort(), ['console.secrets.consumer.reload-requested', 'console.secrets.rotation.grace-started', 'console.secrets.rotation.initiated']);
  assert.equal(f.patches.length, 1);
  assert.ok(f.pool.queries.some(q => q.sql === 'COMMIT'));
});

test('KV write failure rolls back and emits nothing', async t => {
  const f = await fixture(t, { kvFail: true });
  assert.deepEqual(await f.request('platform/app-password/rotate', { method: 'POST', body: { newValue: 'fixture-value', gracePeriodSeconds: 1800 } }), { status: 502, body: { error: { code: 'VAULT_WRITE_FAILED', status: 502 } } });
  assert.ok(f.pool.queries.some(q => q.sql === 'ROLLBACK'));
  assert.ok(!f.pool.queries.some(q => q.sql === 'COMMIT'));
  assert.deepEqual(f.published, []);
  assert.deepEqual(f.patches, []);
});

test('revoke returns numeric version and soft deletes only the requested version', async t => {
  const f = await fixture(t);
  const result = await f.request('platform/app-password/versions/1/revoke', { method: 'POST', body: { justification: 'private-justification' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.revokedVersion, 1);
  assert.ok(!Number.isNaN(Date.parse(result.body.effectiveAt)));
  assert.deepEqual(f.kv, [{ method: 'POST', url: 'http://bao/v1/secret/delete/platform/app-password', body: { versions: [1] } }]);
});

test('KV soft delete failure rolls back and returns a safe 502', async t => {
  const f = await fixture(t, { kvFail: true });
  assert.deepEqual(await f.request('platform/app-password/versions/1/revoke', { method: 'POST', body: {} }), { status: 502, body: { error: { code: 'VAULT_DELETE_FAILED', status: 502 } } });
  assert.ok(f.pool.queries.some(q => q.sql === 'ROLLBACK'));
  assert.ok(!f.pool.queries.some(q => q.sql === 'COMMIT'));
  assert.deepEqual(f.published, []);
});

test('committed handlers tolerate rejecting publishers and ESO refreshers', async t => {
  const f = await fixture(t);
  const { main: rotate } = await import('../../packages/provisioning-orchestrator/src/actions/secret-rotation-initiate.mjs');
  const { main: revoke } = await import('../../packages/provisioning-orchestrator/src/actions/secret-rotation-revoke.mjs');
  const params = { auth: { roles: ['superadmin'], sub: 'actor' }, domain: 'platform', tenantId: null, secretPath: 'platform/app-password', newValue: 'fixture-value', gracePeriodSeconds: 1800, db: f.pool,
    vaultClient: { async writeSecret() { return { version: 7 }; }, async deleteSecretVersion() {} },
    publishEvent: async () => { throw Error('private-justification'); }, triggerEsoRefresh: async () => { throw Error('fixture-value'); }, logger: { error: record => f.logs.push(record) } };
  assert.equal((await rotate(params)).vaultVersionNew, 7);
  assert.equal((await revoke({ ...params, vaultVersion: 1 })).revokedVersion, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.logs.length >= 2);
  assert.doesNotMatch(JSON.stringify(f.logs), /fixture-value|private-justification/);
  assert.ok(!f.pool.queries.some(q => q.sql === 'ROLLBACK'));
});

test('consumer status applies the history role gate before reads and returns 404 without lists', async t => {
  const f = await fixture(t);
  for (const [role, domain, status] of [['tenant_viewer', 'tenant', 403], ['tenant_viewer', 'platform', 403], ['platform_operator', 'tenant', 403], ['tenant_operator', 'tenant', 200], ['tenant_owner', 'tenant', 200], ['superadmin', 'platform', 200]]) {
    f.pool.queries.length = 0;
    const bearer = f.server.token({ ...(role.startsWith('platform') || role === 'superadmin' ? { iss: 'http://fixture/realms/platform' } : {}), realm_access: { roles: [role] } });
    const result = await f.request(`${domain}/app-password/consumer-status`, { bearer });
    assert.equal(result.status, status, role);
    if (status === 403) assert.deepEqual(f.pool.queries.filter(q => !q.sql.includes('scope_enforcement_denials')), []);
    else assert.deepEqual(result.body.consumers, [{ consumer_id: 'app', reload_mechanism: 'eso_annotation', state: 'confirmed', confirmedAt: null, timeoutAt: null }]);
  }
  assert.deepEqual(await f.request('platform/app-password/consumer-status?vaultVersion=99'), { status: 404, body: { error: { code: 'VERSION_NOT_FOUND', status: 404 } } });
});

test('consumer status missing version and wrong row owner never read consumer lists', async t => {
  for (const options of [{ noActive: true }, { rowTenant: 'foreign-tenant' }]) {
    const f = await fixture(t, options);
    const result = await f.request('platform/app-password/consumer-status');
    assert.equal(result.status, options.noActive ? 404 : 403);
    assert.ok(!f.pool.queries.some(q => q.sql.includes('secret_consumer_registry') || q.sql.includes('secret_propagation_events')));
  }
});

test('history returns ordered pages with the full count and validates pagination before reads', async t => {
  const f = await fixture(t);
  const page = await f.request('platform/app-password/history?limit=2&offset=0');
  assert.equal(page.status, 200);
  assert.equal(page.body.total, 3);
  assert.deepEqual(page.body.items.map(e => e.occurred_at), ['2026-10-16T03:00:00Z', '2026-10-16T02:00:00Z']);
  const last = await f.request('platform/app-password/history?limit=2&offset=2');
  assert.equal(last.body.total, 3);
  assert.deepEqual(last.body.items, [{ event_type: 'initiated', actor_id: 'actor', occurred_at: '2026-10-16T01:00:00Z' }]);
  assert.doesNotMatch(JSON.stringify(page.body), /__total|newValue|"value"/);
  for (const query of ['limit=0', 'limit=101', 'limit=x', 'offset=-1']) {
    f.pool.queries.length = 0;
    assert.deepEqual(await f.request(`platform/app-password/history?${query}`), { status: 400, body: { error: { code: 'INVALID_PAGINATION', status: 400 } } });
    assert.deepEqual(f.pool.queries, []);
  }
});

test('keyed invalid POSTs touch only idempotency records', async t => {
  const f = await fixture(t);
  for (const path of ['platform/.hidden/rotate', 'platform/app-password/versions/abc/revoke', 'platform/app-password/versions/0/revoke']) {
    f.pool.queries.length = 0;
    const result = await f.request(path, { method: 'POST', body: {}, headers: { 'idempotency-key': `fixture-${path.replace(/[^a-zA-Z0-9]/g, '-')}` } });
    assert.equal(result.status, 400);
    assert.ok(f.pool.queries.length > 0);
    assert.ok(f.pool.queries.every(q => q.sql.includes('http_idempotency_records')));
  }
  assert.deepEqual(f.kv, []);
  assert.deepEqual(f.published, []);
  assert.deepEqual(f.patches, []);
});

test('missing and last-valid revoke targets never reach KV', async t => {
  const f = await fixture(t, { noGrace: true });
  for (const [version, status, code] of [[99, 404, 'VERSION_NOT_FOUND'], [2, 409, 'REVOKE_LEAVES_NO_ACTIVE_VERSION']]) {
    assert.deepEqual(await f.request(`platform/app-password/versions/${version}/revoke`, { method: 'POST', body: {} }), { status, body: { error: { code, status } } });
  }
  assert.deepEqual(f.kv, []);
  assert.deepEqual(f.published, []);
});

test('all four routes preserve the verified role and tenant authorization matrix', async t => {
  const f = await fixture(t);
  const operations = [['history', 'GET'], ['consumer-status', 'GET'], ['rotate', 'POST'], ['versions/1/revoke', 'POST']];
  for (const [role, platform, tenantId, domain, read, write] of [
    ['superadmin', true, undefined, 'platform', 200, 200],
    ['superadmin', true, undefined, 'tenant', 403, 403],
    ['superadmin', true, '11111111-1111-1111-1111-111111111111', 'tenant', 200, 200],
    ['platform_operator', true, undefined, 'platform', 200, 200],
    ['platform_operator', true, '11111111-1111-1111-1111-111111111111', 'tenant', 403, 403],
    ['tenant_owner', false, undefined, 'tenant', 200, 200],
    ['tenant_owner', false, undefined, 'platform', 403, 403],
    ['tenant_operator', false, undefined, 'tenant', 200, 403],
    ['tenant_operator', false, undefined, 'platform', 403, 403],
    ['tenant_viewer', false, undefined, 'tenant', 403, 403],
    ['tenant_viewer', false, undefined, 'platform', 403, 403],
  ]) {
    const bearer = f.server.token({ ...(platform ? { iss: 'http://fixture/realms/platform' } : {}), ...(tenantId ? { tenant_id: tenantId } : {}), realm_access: { roles: [role] } });
    for (const [path, method] of operations) {
      const result = await f.request(`${domain}/app-password/${path}`, { bearer, method, ...(method === 'POST' ? { body: { newValue: 'fixture-value', gracePeriodSeconds: 1800 } } : {}) });
      assert.equal(result.status, method === 'GET' ? read : write, `${role} ${tenantId} ${domain} ${path}`);
    }
  }
});

test('HTTP success survives side effect failures without logging request values', async t => {
  const f = await fixture(t, { sideEffectFail: true });
  const result = await f.request('platform/app-password/rotate', { method: 'POST', body: { newValue: 'fixture-value', justification: 'private-justification', gracePeriodSeconds: 1800 } });
  assert.equal(result.status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.logs.length, 4);
  assert.ok(f.logs.every(l => l.event === 'secret_rotation_side_effect_failed'));
  assert.doesNotMatch(JSON.stringify(f.logs), /fixture-value|private-justification/);
});

test('encoded allowed names resolve once to the canonical KV key', async t => {
  const f = await fixture(t);
  const result = await f.request('platform/%61pp-password/rotate', { method: 'POST', body: { newValue: 'fixture-value', gracePeriodSeconds: 1800, secretPath: 'tenant/spoofed/key', tenantId: 'spoofed', vaultClient: {} } });
  assert.equal(result.status, 200);
  assert.deepEqual(f.kv, [{ method: 'POST', url: 'http://bao/v1/secret/data/platform/app-password', body: { data: { value: 'fixture-value' } } }]);
});
