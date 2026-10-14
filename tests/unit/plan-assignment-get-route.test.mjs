import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { invokeRoute } from '../../apps/control-plane/route-invoke.mjs';

const runtimeRouteMap = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));

function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

const compiledRoutes = runtimeRouteMap
  .map((r) => ({ ...r, _rx: compilePath(r.path) }))
  .sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
    || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));

function matchRoute(path) {
  for (const route of compiledRoutes) {
    if (route.method !== 'GET' && route.method !== 'ANY') continue;
    const match = route._rx.exec(path);
    if (match) return { route, params: { ...match.groups } };
  }
  assert.fail(`GET ${path} must resolve in the runtime route table`);
}

function identity(actorType = 'tenant_owner', roles = ['tenant_owner']) {
  return { sub: 'owner-a', actorType, tenantId: 'tenant-a', workspaceId: null, roles, scopes: [] };
}

async function dispatch(path, verifiedIdentity, db, contextOverrides = {}) {
  const { route, params } = matchRoute(path);
  assert.ok(route.module.startsWith('/repo/'));
  const module = await import(new URL('../../' + route.module.slice('/repo/'.length), import.meta.url));
  // The identity is already verified and role-derived, as at server.mjs callerContextFrom.
  const callerContext = {
    actor: { id: verifiedIdentity.sub, type: verifiedIdentity.actorType, tenantId: verifiedIdentity.tenantId,
      roles: verifiedIdentity.roles, scopes: verifiedIdentity.scopes },
    tenantId: verifiedIdentity.tenantId, workspaceId: verifiedIdentity.workspaceId, correlationId: null
  };
  return invokeRoute(route, module[route.export ?? 'main'], params, { ...callerContext, ...contextOverrides }, verifiedIdentity, db);
}

function database(rows = []) {
  const queries = [];
  return { queries, async query(sql, values) { queries.push({ sql, values }); return { rows }; } };
}

test('M7 lets a control-plane tenant_owner read its own plan', async () => {
  const db = database();
  const result = await dispatch('/v1/tenant/plan', identity(), db);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.noAssignment, true);
  assert.equal(result.body.tenantId, 'tenant-a');
  assert.deepEqual(db.queries.map(({ values }) => values), [['tenant-a']]);
});

test('M7 and M8 retain their runtime dispatch and authentication contracts', () => {
  for (const [path, template, params] of [
    ['/v1/tenant/plan', '/v1/tenant/plan', {}],
    ['/v1/tenants/tenant-a/plan', '/v1/tenants/{tenantId}/plan', { tenantId: 'tenant-a' }]
  ]) {
    const hit = matchRoute(path);
    assert.equal(hit.route.method, 'GET');
    assert.equal(hit.route.path, template);
    assert.equal(hit.route.module, '/repo/packages/provisioning-orchestrator/src/actions/plan-assignment-get.mjs');
    assert.equal(hit.route.export, 'main');
    assert.equal(hit.route.invoke, 'callercontext-overrides');
    assert.deepEqual(hit.route.deps, ['db']);
    assert.equal(hit.route.auth, 'authenticated');
    assert.deepEqual(hit.params, params);
  }
});

// Verified identity fixtures: server.mjs maps each of these realm roles to tenant_owner.
const owners = [
  ['tenant_owner', identity()],
  ['mapped tenant_admin', identity('tenant_owner', ['tenant_admin'])],
  ['legacy tenant-owner', identity('tenant-owner', ['tenant-owner'])]
];
const ownPaths = ['/v1/tenant/plan', '/v1/tenants/tenant-a/plan'];
const assignmentRow = {
  id: 'assignment-a', tenant_id: 'tenant-a', plan_id: 'plan-a', assigned_by: 'superadmin-a',
  effective_from: '2026-10-14T00:00:00.000Z', assignment_metadata: {},
  plan_slug: 'starter', plan_display_name: 'Starter', plan_status: 'active'
};

for (const [name, owner] of owners) {
  for (const path of ownPaths) {
    for (const assigned of [false, true]) {
      test(`${name} reads its own ${assigned ? 'assigned plan' : 'unassigned tenant'} via GET ${path}`, async () => {
        const db = database(assigned ? [assignmentRow] : []);
        const result = await dispatch(path, owner, db);
        assert.equal(result.statusCode, 200);
        if (assigned) {
          assert.equal(result.body.assignment.tenantId, 'tenant-a');
          assert.equal(result.body.assignment.assignmentId, 'assignment-a');
          assert.equal(result.body.plan.slug, 'starter');
        } else {
          assert.deepEqual(result.body, { noAssignment: true, tenantId: 'tenant-a' });
        }
        assert.deepEqual(db.queries.map(({ values }) => values), [['tenant-a']]);
      });
    }
  }
  test(`${name} cannot read another tenant via M8 and never queries the database`, async () => {
    const db = database([assignmentRow]);
    await assert.rejects(dispatch('/v1/tenants/tenant-b/plan', owner, db), { code: 'FORBIDDEN', statusCode: 403 });
    assert.deepEqual(db.queries, []);
  });
}

for (const actorType of ['workspace_admin', 'tenant_member', 'internal', 'tenant_admin', 'tenant']) {
  for (const path of ownPaths) {
    test(`${actorType} is forbidden on GET ${path} before querying the database`, async () => {
      const db = database();
      await assert.rejects(dispatch(path, identity(actorType, [actorType]), db), { code: 'FORBIDDEN', statusCode: 403 });
      assert.deepEqual(db.queries, []);
    });
  }
}

for (const tenantId of ['tenant-a', 'tenant-b']) {
  test(`superadmin retains M8 access to ${tenantId}`, async () => {
    const db = database();
    const result = await dispatch(`/v1/tenants/${tenantId}/plan`, identity('superadmin', ['superadmin']), db);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { noAssignment: true, tenantId });
    assert.deepEqual(db.queries.map(({ values }) => values), [[tenantId]]);
  });
}

for (const path of ownPaths) {
  test(`a missing actor id is forbidden on GET ${path} without a database read`, async () => {
    const db = database();
    await assert.rejects(dispatch(path, { ...identity(), sub: undefined }, db), { code: 'FORBIDDEN', statusCode: 403 });
    assert.deepEqual(db.queries, []);
  });
}

test('M7 requires a scoped tenant before reading the database', async () => {
  const db = database();
  await assert.rejects(dispatch('/v1/tenant/plan', { ...identity(), tenantId: undefined }, db), { code: 'VALIDATION_ERROR', statusCode: 400 });
  assert.deepEqual(db.queries, []);
});

for (const [name, owner] of owners) {
  test(`${name} falls back to actor.tenantId when callerContext.tenantId is absent`, async () => {
    const db = database();
    const result = await dispatch('/v1/tenant/plan', owner, db, { tenantId: undefined });
    assert.equal(result.statusCode, 200);
    assert.equal(result.body.tenantId, 'tenant-a');
    assert.deepEqual(db.queries.map(({ values }) => values), [['tenant-a']]);
    const deniedDb = database();
    await assert.rejects(dispatch('/v1/tenants/tenant-b/plan', owner, deniedDb, { tenantId: undefined }), { code: 'FORBIDDEN', statusCode: 403 });
    assert.deepEqual(deniedDb.queries, []);
  });
}
