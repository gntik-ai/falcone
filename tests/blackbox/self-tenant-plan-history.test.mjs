import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { routes } from '../../apps/control-plane/routes.mjs';
import { startDenialServer, TEN_A } from './helpers/authorization-denial-server.mjs';

const path = '/v1/tenant/plan/history';

async function historyServer(fixture = []) {
  const server = await startDenialServer();
  const historyQueries = [];
  server.pool.query = async (sql, values = []) => {
    if (sql.includes('tenant_plan_assignments')) {
      historyQueries.push({ sql, values });
      assert.equal(values[0], TEN_A);
      return { rows: sql.includes('COUNT(*)') ? [{ total: fixture.length }]
        : fixture.slice(values[2], values[2] + values[1]) };
    }
    // The real HTTP listener also writes audit records at the DB boundary.
    return { rows: [] };
  };
  return { ...server, historyQueries };
}

test('the seed and inventory declare the same tenant-owner self-history action', async () => {
  const route = routes.find(route => route.method === 'GET' && route.path === path);
  assert.ok(route);
  assert.equal(route.auth, 'tenant_owner');
  assert.equal(route.invoke, 'callercontext-overrides');
  assert.equal(route.export, 'main');
  assert.equal(route.mergeQueryIntoParams, true);
  assert.deepEqual(route.deps, ['db']);
  const catalog = JSON.parse(await readFile(new URL('../../apps/control-plane/route-map.json', import.meta.url)));
  const entry = catalog.find(route => route.method === 'GET' && route.path === path);
  assert.ok(entry);
  assert.equal(route.module, `/repo/${entry.module}`);
  assert.equal(entry.export, route.export);
  assert.equal(entry.invoke, route.invoke);
});

test('verified tenant-owner and tenant-admin tokens can read their own history over HTTP', async () => {
  const server = await historyServer();
  for (const claims of [
    { actor_type: 'tenant_owner', realm_access: { roles: [] } },
    { realm_access: { roles: ['tenant_owner'] } },
    { realm_access: { roles: ['tenant_admin'] } }
  ]) {
    const response = await server.request(path, { bearer: server.token(claims) });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { tenantId: TEN_A, assignments: [], total: 0, page: 1, pageSize: 20 });
  }
});

test('HTTP returns projected history and paginates only the verified issuer tenant', async () => {
  // The database boundary returns rows in its effective_from DESC query order.
  const fixture = [
    { id: 'current', effective_from: '2026-03-01T00:00:00Z', superseded_at: null },
    { id: 'middle', effective_from: '2026-02-01T00:00:00Z', superseded_at: '2026-03-01T00:00:00Z' },
    { id: 'oldest', effective_from: '2026-01-01T00:00:00Z', superseded_at: '2026-02-01T00:00:00Z' }
  ].map(row => ({ ...row, tenant_id: TEN_A, plan_id: 'plan-starter', plan_slug: 'starter',
    plan_display_name: 'Starter', plan_status: 'active', assigned_by: 'private-operator',
    assignment_metadata: { note: 'private' }, plan_description: 'private description',
    capabilities: { storage: true }, quota_dimensions: { storage: 10 } }));
  const server = await historyServer(fixture);
  const bearer = server.token({ tenant_id: 'tenant-other', realm_access: { roles: ['tenant_owner'] } });
  const response = await server.request(path, { bearer });
  assert.equal(response.status, 200);
  const expected = [
    { assignmentId: 'current', planId: 'plan-starter', planSlug: 'starter', planDisplayName: 'Starter', planStatus: 'active', effectiveFrom: '2026-03-01T00:00:00Z', supersededAt: null },
    { assignmentId: 'middle', planId: 'plan-starter', planSlug: 'starter', planDisplayName: 'Starter', planStatus: 'active', effectiveFrom: '2026-02-01T00:00:00Z', supersededAt: '2026-03-01T00:00:00Z' },
    { assignmentId: 'oldest', planId: 'plan-starter', planSlug: 'starter', planDisplayName: 'Starter', planStatus: 'active', effectiveFrom: '2026-01-01T00:00:00Z', supersededAt: '2026-02-01T00:00:00Z' }
  ];
  assert.deepEqual(JSON.parse(response.body), { tenantId: TEN_A, assignments: expected, total: 3, page: 1, pageSize: 20 });
  const secondPage = await server.request(`${path}?page=2&pageSize=2`, { bearer });
  assert.equal(secondPage.status, 200);
  assert.deepEqual(JSON.parse(secondPage.body), { tenantId: TEN_A, assignments: [expected[2]], total: 3, page: 2, pageSize: 2 });
});

test('tenant-owner and tenant actor types require a qualifying realm role at the HTTP gate', async () => {
  const server = await historyServer();
  for (const actor_type of ['tenant-owner', 'tenant']) {
    const before = server.historyQueries.length;
    const denied = await server.request(path, { bearer: server.token({ actor_type, realm_access: { roles: [] } }) });
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(denied.body).code, 'FORBIDDEN');
    assert.equal(server.historyQueries.length, before);
    for (const role of ['tenant_owner', 'tenant_admin']) {
      const allowed = await server.request(path, { bearer: server.token({ actor_type, realm_access: { roles: [role] } }) });
      assert.equal(allowed.status, 200);
      assert.equal(JSON.parse(allowed.body).tenantId, TEN_A);
    }
  }
});

test('HTTP denies other actor types, missing identity and tenant, cross-tenant queries and missing bearer', async () => {
  const server = await historyServer();
  const denied = [
    ...['superadmin', 'internal', 'tenant_member', 'workspace_admin', 'tenant_admin', 'other'].map(actor_type => ({ actor_type })),
    { sub: '', actor_type: 'tenant_owner' },
    ...['tenant_owner', 'tenant-owner', 'tenant'].map(actor_type => ({ iss: 'http://fixture/realms/platform', actor_type }))
  ];
  for (const claims of denied) {
    const response = await server.request(`${path}?tenantId=${TEN_A}`, { bearer: server.token({ realm_access: { roles: ['tenant_owner'] }, ...claims }) });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body).code, 'FORBIDDEN');
    assert.equal(JSON.parse(response.body).assignments, undefined);
  }
  const bearer = server.token({ realm_access: { roles: ['tenant_owner'] } });
  const crossTenant = await server.request(`${path}?tenantId=tenant-other`, { bearer });
  assert.equal(crossTenant.status, 403);
  assert.equal(JSON.parse(crossTenant.body).code, 'FORBIDDEN');
  const anonymous = await server.request(path, { bearer: null });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(server.historyQueries, []);
  const omitted = await server.request(path, { bearer });
  const equal = await server.request(`${path}?tenantId=${TEN_A}`, { bearer });
  assert.equal(equal.status, 200);
  assert.equal(equal.body, omitted.body);
});

test('HTTP strictly validates page and pageSize and merges valid pagination', async () => {
  const server = await historyServer();
  const bearer = server.token({ realm_access: { roles: ['tenant_owner'] } });
  for (const key of ['page', 'pageSize']) {
    for (const value of ['0', '1.5', '2abc', '-1', '', ' 2']) {
      const response = await server.request(`${path}?${key}=${encodeURIComponent(value)}`, { bearer });
      assert.equal(response.status, 400);
      assert.equal(JSON.parse(response.body).code, 'VALIDATION_ERROR');
    }
  }
  const tooLarge = await server.request(`${path}?pageSize=101`, { bearer });
  assert.equal(tooLarge.status, 400);
  assert.deepEqual(server.historyQueries, []);
  const valid = await server.request(`${path}?page=2&pageSize=2`, { bearer });
  assert.equal(valid.status, 200);
  assert.deepEqual(JSON.parse(valid.body), { tenantId: TEN_A, assignments: [], total: 0, page: 2, pageSize: 2 });
});

test('tenant-id scoped history remains superadmin-only over HTTP', async () => {
  const server = await historyServer();
  const scoped = `/v1/tenants/${TEN_A}/plan/history`;
  for (const actor_type of ['tenant_owner', 'tenant-owner', 'tenant', 'tenant_member', 'workspace_admin', 'internal', 'other']) {
    const denied = await server.request(scoped, { bearer: server.token({ actor_type }) });
    assert.equal(denied.status, 403);
    assert.equal(JSON.parse(denied.body).code, 'FORBIDDEN');
  }
  assert.deepEqual(server.historyQueries, []);
  const allowed = await server.request(scoped, { bearer: server.token({
    iss: 'http://fixture/realms/platform', tenant_id: TEN_A, realm_access: { roles: ['superadmin'] }
  }) });
  assert.equal(allowed.status, 200);
  assert.deepEqual(JSON.parse(allowed.body), { assignments: [], total: 0, page: 1, pageSize: 20 });
});

test('the gateway self-history route requires OIDC and retains correlation and metrics', async () => {
  const config = parse(await readFile(new URL('../../deploy/gateway-config/routes/plan-management-routes.yaml', import.meta.url), 'utf8'));
  const route = config.routes.find(route => route.name === 'self-tenant-plan-history');
  assert.ok(route);
  assert.equal(route.uri, path);
  assert.deepEqual(route.methods, ['GET']);
  assert.equal(route.plugins['keycloak-openid-connect'].enabled, true);
  assert.equal(route.plugins['correlation-id'].header_name, 'X-Correlation-Id');
  assert.equal(route.plugins.prometheus.prefer_name, true);
});
