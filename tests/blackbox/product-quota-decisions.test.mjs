import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { startDenialServer } from './helpers/authorization-denial-server.mjs';
import { quotaPool } from '../helpers/product-quota-fixture.mjs';

const key = 'codewiki_max_projects';
const path = '/v1/workspaces/ws-a/quota-decisions';
const owner = { sub: 'actor-a', tenant_id: 'tenant-a', actor_type: 'tenant_owner' };
async function fixture(t, options = {}) {
  const pool = quotaPool(options);
  const server = await startDenialServer({ database: pool, localHandlers: LOCAL_HANDLERS,
    verifier: { verify: async token => ({ payload: JSON.parse(token), trust: { kind: 'tenant', realm: 'tenant-a' } }) } });
  t.after(() => server.close());
  return { pool, async request(body = { dimensionKey: key, currentUsage: 0 }, claims = owner, workspaceId = 'ws-a') {
    const response = await server.request(path.replace('ws-a', workspaceId), { method: 'POST', body: JSON.stringify(body), bearer: JSON.stringify(claims) });
    return { status: response.status, body: JSON.parse(response.body) };
  } };
}

test('HTTP decision allows exact fill, denies overflow with 200, and audits only the denial', async t => {
  const { pool, request } = await fixture(t);
  assert.deepEqual(await request({ dimensionKey: key, currentUsage: 2 }), { status: 200, body: {
    allowed: true, decision: 'allowed', dimensionKey: key, quotaType: 'hard', effectiveLimit: 3, effectiveCeiling: 3,
    currentUsage: 2, projectedUsage: 3, source: 'default',
  } });
  assert.equal(pool.logs.length, 0);
  const denied = await request({ dimensionKey: key, currentUsage: 3, attemptedAction: 'project.create' });
  assert.deepEqual(denied, { status: 200, body: {
    allowed: false, decision: 'hard_blocked', dimensionKey: key, quotaType: 'hard', effectiveLimit: 3, effectiveCeiling: 3,
    currentUsage: 3, projectedUsage: 4, source: 'default',
  } });
  assert.equal(pool.logs.length, 1);
  assert.deepEqual(pool.logs[0].slice(1, 5), ['tenant-a', 'ws-a', key, 'project.create']);
  assert.deepEqual(pool.logs[0].slice(12, 14), ['actor-a', 'corr-fixture']);
});

test('body validation rejects bad usage, quantity, action, unknown fields and non-product keys', async t => {
  const { pool, request } = await fixture(t);
  const valid = { dimensionKey: key, currentUsage: 0 };
  const invalid = [
    {}, { ...valid, currentUsage: undefined }, { ...valid, currentUsage: -1 }, { ...valid, currentUsage: 0.5 },
    { ...valid, currentUsage: '0' }, { ...valid, currentUsage: null },
    { ...valid, requested: 0 }, { ...valid, requested: -1 }, { ...valid, requested: 1.5 },
    { ...valid, requested: '1' }, { ...valid, requested: null },
    { ...valid, attemptedAction: '' }, { ...valid, attemptedAction: 'A' }, { ...valid, attemptedAction: 'has space' },
    { ...valid, attemptedAction: 'a'.repeat(65) }, { ...valid, attemptedAction: null },
    { ...valid, attemptedAction: 1 }, { ...valid, tenantId: 'tenant-b' },
    { ...valid, dimensionKey: 'max_workspaces' }, { ...valid, dimensionKey: 'codewiki_unknown' },
    { ...valid, dimensionKey: null }, { ...valid, dimensionKey: 1 },
    { ...valid, dimensionKey: 'codewiki_max_repository_bytes', currentUsage: 1 },
    [], null, true, 1,
  ];
  for (const body of invalid) {
    const result = await request(body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.body.code, 'VALIDATION_ERROR');
  }
  assert.equal((await request({ ...valid, attemptedAction: 'a'.repeat(64) })).status, 200);
  assert.equal((await request({ ...valid, attemptedAction: 'snapshot.index-v1_2' })).status, 200);
  assert.equal(pool.logs.length, 0);
});

test('tenant authorization precedes evaluation and quota logging, including cross-tenant workspace bindings', async t => {
  const body = { dimensionKey: key, currentUsage: 999 };
  for (const claims of [owner, { ...owner, actor_type: 'tenant_member', workspace_id: 'ws-a' },
    { ...owner, actor_type: 'tenant_member', workspace_ids: ['ws-a'] }]) {
    const foreign = await fixture(t, { workspaceTenant: 'tenant-b', failure: 'quota_dimension_catalog' });
    assert.equal((await foreign.request(body, claims)).status, 403);
    assert.equal(foreign.pool.logs.length, 0);
  }
  const own = await fixture(t);
  for (const claims of [owner, { ...owner, actor_type: 'tenant_admin' },
    { ...owner, actor_type: 'tenant_member', workspace_id: 'ws-a' },
    { ...owner, actor_type: 'tenant_member', workspace_ids: ['other', 'ws-a'] }]) {
    assert.equal((await own.request(undefined, claims)).status, 200);
  }
  for (const claims of [{ ...owner, actor_type: 'tenant_member' },
    { ...owner, actor_type: 'tenant_member', workspace_id: 'other' }]) {
    assert.equal((await own.request(body, claims)).status, 403);
  }
  const missing = await fixture(t, { missingWorkspace: true });
  assert.equal((await missing.request()).status, 404);
  assert.equal(missing.pool.logs.length, 0);
});

test('workspace IDs resolve exactly despite colliding slugs; slug-only paths are not IDs', async t => {
  const { pool, request } = await fixture(t, { workspaces: [
    { id: 'ws-b', tenant_id: 'tenant-b', slug: 'ws-a' },
    { id: 'ws-a', tenant_id: 'tenant-a', slug: 'shared' },
    { id: 'ws-c', tenant_id: 'tenant-c', slug: 'shared' },
  ] });
  for (const claims of [owner, { ...owner, actor_type: 'tenant_member', workspace_id: 'ws-a' }]) {
    const result = await request(undefined, claims);
    assert.equal(result.status, 200);
    assert.equal(result.body.allowed, true);
  }
  assert.equal((await request(undefined, owner, 'shared')).status, 404);
  assert.equal((await request(undefined, owner, 'ws-b')).status, 403);
  assert.equal(pool.logs.length, 0);
});

test('catalog and resolver outages return 503, while audit outages cannot allow a denial', async t => {
  for (const failure of ['quota_dimension_catalog', 'tenant_plan_assignments', 'quota_overrides']) {
    const { request, pool } = await fixture(t, { failure });
    const result = await request();
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'QUOTA_UNAVAILABLE');
    assert.notEqual(result.body.allowed, true);
    assert.equal(pool.logs.length, 0);
  }
  const { request } = await fixture(t, { failLog: true });
  const denied = await request({ dimensionKey: key, currentUsage: 3 });
  assert.equal(denied.status, 200);
  assert.equal(denied.body.allowed, false);
});

test('snapshot bytes stay per request through HTTP', async t => {
  const { request } = await fixture(t);
  const dimensionKey = 'codewiki_max_repository_bytes';
  for (let i = 0; i < 2; i++) assert.equal((await request({ dimensionKey, currentUsage: 0, requested: 419430400 })).body.allowed, true);
  assert.equal((await request({ dimensionKey, currentUsage: 0, requested: 629145600 })).body.allowed, false);
});

test('soft decisions report full requested usage in warnings and deny at the exclusive ceiling', async t => {
  const { request, pool } = await fixture(t, {
    plan: { [key]: 3 }, types: { [key]: { type: 'soft', graceMargin: 2 } },
  });
  assert.deepEqual(await request({ dimensionKey: key, currentUsage: 1, requested: 2 }), { status: 200, body: {
    allowed: true, decision: 'allowed', dimensionKey: key, quotaType: 'soft', effectiveLimit: 3, effectiveCeiling: 5,
    currentUsage: 1, projectedUsage: 3, source: 'plan',
  } });
  assert.deepEqual(await request({ dimensionKey: key, currentUsage: 1, requested: 3 }), { status: 200, body: {
    allowed: true, decision: 'soft_grace_allowed', dimensionKey: key, quotaType: 'soft', effectiveLimit: 3, effectiveCeiling: 5,
    currentUsage: 1, projectedUsage: 4, source: 'plan', warning: 'Soft quota exceeded. Usage 4/3 (grace ceiling: 5).',
  } });
  assert.equal(pool.logs.length, 0);
  assert.deepEqual(await request({ dimensionKey: key, currentUsage: 1, requested: 4, attemptedAction: 'project.create' }), {
    status: 200, body: {
      allowed: false, decision: 'soft_grace_exhausted', dimensionKey: key, quotaType: 'soft', effectiveLimit: 3, effectiveCeiling: 5,
      currentUsage: 1, projectedUsage: 5, source: 'plan',
    },
  });
  assert.equal(pool.logs.length, 1);
  assert.deepEqual(pool.logs[0].slice(1, 5), ['tenant-a', 'ws-a', key, 'project.create']);
});
