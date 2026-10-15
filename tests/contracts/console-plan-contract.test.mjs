import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import { invokeRoute } from '../../apps/control-plane/route-invoke.mjs';
import { routes as seed } from '../../apps/control-plane/routes.mjs';
import { effectiveRoutes } from './helpers/console-publication.mjs';

const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url)));
const document = read('apps/control-plane-executor/openapi/control-plane.openapi.json');
const runtime = effectiveRoutes(seed, read('apps/control-plane/route-map.runtime.json'));
const validate = (schema, value) => {
  const ajv = new Ajv({ strict: false, validateFormats: false });
  const check = ajv.compile({ ...schema, components: document.components });
  assert.ok(check(value), JSON.stringify(check.errors));
};
async function dispatch(method, path, actorType, tenantId, params = {}, db = { async query() { return { rows: [] }; } }) {
  const route = runtime.find(r => r.method === method && r.path === path);
  assert.ok(route, `${method} ${path}`);
  const module = await import(new URL(`../../${route.module.replace('/repo/', '')}`, import.meta.url));
  const actor = { id: 'fixture-actor', type: actorType, tenantId };
  return invokeRoute(route, module[route.export ?? 'main'], params, { actor, tenantId },
    { sub: actor.id, actorType, tenantId, roles: [actorType], scopes: [] }, db);
}

test('plan and quota listing schemas validate real handler output and reject the wrong envelopes', async () => {
  const db = { async query(sql) {
    if (sql.includes('COUNT')) return { rows: [{ total: 1 }] };
    return { rows: [{ id: 'plan-a', slug: 'starter', display_name: 'Starter', description: null, status: 'active',
      capabilities: { api: true }, quota_dimensions: { requests: 100 }, created_at: '2026-10-14T00:00:00Z', updated_at: null, created_by: 'actor', updated_by: null }] };
  } };
  const result = await dispatch('GET', '/v1/plans', 'superadmin', undefined, {}, db);
  assert.deepEqual(result.body.plans[0].quotaDimensions, { requests: 100 });
  assert.equal(result.body.pageSize, 20);
  validate(document.paths['/v1/plans'].get.responses['200'].content['application/json'].schema, result.body);
  const dimensions = await dispatch('GET', '/v1/quota-dimensions', 'superadmin', undefined, {}, {
    async query() { return { rows: [{ dimension_key: 'requests', display_label: 'Requests', unit: 'count', default_value: '100', description: null }] }; }
  });
  assert.deepEqual(dimensions.body, { dimensions: [{ dimensionKey: 'requests', displayLabel: 'Requests', unit: 'count', defaultValue: 100, description: null }], total: 1 });
  validate(document.paths['/v1/quota-dimensions'].get.responses['200'].content['application/json'].schema, dimensions.body);
  assert.throws(() => validate(document.paths['/v1/plans'].get.responses['200'].content['application/json'].schema, { items: [], total: 0 }));
  assert.throws(() => validate(document.paths['/v1/quota-dimensions'].get.responses['200'].content['application/json'].schema, { items: [], total: 0 }));
});

test('M9 publishes the assignment response status and shape returned by plan-assign', () => {
  const response = document.paths['/v1/tenants/{tenantId}/plan'].post.responses['200'];
  assert.ok(response, 'plan-assign returns 200');
  validate(response.content['application/json'].schema, { assignmentId: 'assignment-a', tenantId: 'tenant-a', planId: 'plan-a',
    effectiveFrom: '2026-10-14T00:00:00Z', previousPlanId: null, historyEntryId: null, changeDirection: 'initial',
    overLimitDimensionCount: 0, usageCollectionStatus: 'unavailable' });
});

for (const [path, params] of [['/v1/tenant/plan', {}], ['/v1/tenants/{tenantId}/plan', { tenantId: 'tenant-a' }]]) {
  for (const actorType of ['tenant_owner', 'superadmin']) {
    test(`${actorType} reads its own plan through invokeRoute ${path}`, async () => {
      const result = await dispatch('GET', path, actorType, 'tenant-a', params);
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.body, { noAssignment: true, tenantId: 'tenant-a' });
      validate(document.paths[path].get.responses['200'].content['application/json'].schema, result.body);
    });
  }
  for (const actorType of ['tenant_member', 'workspace_admin', 'internal']) {
    test(`${actorType} cannot read a plan through ${path}`, async () => {
      await assert.rejects(dispatch('GET', path, actorType, 'tenant-a', params, { query() { assert.fail('denial must precede database access'); } }), { statusCode: 403, code: 'FORBIDDEN' });
    });
  }
}
test('M8 denies a cross-tenant owner before querying and allows a superadmin', async () => {
  await assert.rejects(dispatch('GET', '/v1/tenants/{tenantId}/plan', 'tenant_owner', 'tenant-a', { tenantId: 'tenant-b' }, {
    query() { assert.fail('cross-tenant denial must precede database access'); }
  }), { statusCode: 403, code: 'FORBIDDEN' });
  const result = await dispatch('GET', '/v1/tenants/{tenantId}/plan', 'superadmin', 'tenant-a', { tenantId: 'tenant-b' });
  assert.deepEqual(result.body, { noAssignment: true, tenantId: 'tenant-b' });
});

test('M7 has no tenant input and requires a token-derived tenant, including for superadmin', async () => {
  const op = document.paths['/v1/tenant/plan'].get;
  assert.equal(op['x-actor-type-authorization'].tenantResolution, 'token');
  assert.ok(!op.requestBody);
  assert.ok(!op.parameters.some(p => p.name === 'tenantId' || p.$ref?.endsWith('/TenantId')));
  const route = runtime.find(route => route.method === 'GET' && route.path === '/v1/tenant/plan');
  assert.ok(!route.mergeQueryIntoParams && !route.mergeBodyIntoParams, 'request data cannot override token tenant scope');
  await assert.rejects(dispatch('GET', '/v1/tenant/plan', 'superadmin', undefined), { statusCode: 400, code: 'VALIDATION_ERROR' });
});

test('M1-M6 and M9 advertise superadmin authority and required error codes', () => {
  for (const [method, path] of [['get','/v1/plans'],['post','/v1/plans'],['put','/v1/plans/{planId}'],['delete','/v1/plans/{planId}'],['post','/v1/plans/{planId}/lifecycle'],['get','/v1/quota-dimensions'],['post','/v1/tenants/{tenantId}/plan']]) {
    const op = document.paths[path][method];
    assert.deepEqual(op['x-audiences'], ['superadmin']);
    assert.match(op.responses['403'].description, /FORBIDDEN/);
    assert.match(op.responses['400'].description, /VALIDATION_ERROR/);
  }
});
