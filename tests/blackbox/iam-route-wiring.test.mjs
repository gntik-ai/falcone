/**
 * Black-box tests for fix-iam-route-wiring (#598, P2, live E2E re-run 2026-06-18).
 *
 * Gap: getIamUser, getIamRole/deleteIamRole, and realm CRUD (list/get/update) were in the
 * public route catalog but returned 404 NO_ROUTE in the kind runtime — the handlers were
 * never registered.
 *
 * Fix: register the handlers and route entries. This test asserts (a) the six catalogued
 * operations now resolve to a handler in the kind route table, and (b) each handler behaves,
 * driven with a stub pool (realm→tenant) + an injected ctx.kcAdmin (mirrors the #567 harness).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { routes } from '../../apps/control-plane/routes.mjs';
import { LOCAL_HANDLERS as HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

const REALM = 'acme29833';
const ACME = 'acme-78848e21';
const GLOBEX = 'globex-fe63fa39';

const pool = {
  query: async (sql, args) => {
    if (/FROM\s+tenants\s+WHERE\s+iam_realm/i.test(sql)) {
      return args?.[0] === REALM ? { rows: [{ id: ACME, tenant_id: ACME, slug: 'acme', display_name: 'Acme', status: 'active', iam_realm: REALM }] } : { rows: [] };
    }
    if (/FROM\s+tenants\s+ORDER\s+BY/i.test(sql)) {
      return { rows: [
        { id: ACME, tenant_id: ACME, slug: 'acme', display_name: 'Acme', status: 'active', iam_realm: REALM, total: 2 },
        { id: GLOBEX, tenant_id: GLOBEX, slug: 'globex', display_name: 'Globex', status: 'active', iam_realm: 'globex-r', total: 2 },
      ] };
    }
    return { rows: [] };
  },
};

function fakeKc(overrides = {}) {
  const calls = [];
  return {
    calls,
    getUser: async (realm, id) => { calls.push(['getUser', realm, id]); return id === 'eu-1' ? { id: 'eu-1', username: 'alice', email: 'a@x.io', enabled: true } : null; },
    listUserRealmRoles: async () => [{ name: 'app_user' }],
    getRealmRole: async (realm, name) => { calls.push(['getRealmRole', realm, name]); return name === 'editor' ? { id: 'r-1', name: 'editor', description: 'd' } : null; },
    deleteRealmRole: async (realm, name) => { calls.push(['deleteRealmRole', realm, name]); },
    getRealmAuthConfig: async (realm) => { calls.push(['getRealmAuthConfig', realm]); return { registrationAllowed: false, loginWithEmailAllowed: true, identityProviders: [] }; },
    setRealmAuthConfig: async (realm, patch) => { calls.push(['setRealmAuthConfig', realm, patch]); },
    ...overrides,
  };
}

const ctx = (identity, extra = {}) => ({ pool, identity, query: {}, body: {}, params: { realmId: REALM }, ...extra });
const acmeOwner = { actorType: 'tenant_owner', tenantId: ACME };
const globexOwner = { actorType: 'tenant_owner', tenantId: GLOBEX };
const superadmin = { actorType: 'superadmin' };

test('bbx-iam-wire-00: the six catalogued IAM operations resolve to a handler', () => {
  const want = [
    ['GET', '/v1/iam/realms', 'iamListRealms'],
    ['GET', '/v1/iam/realms/{realmId}', 'iamGetRealm'],
    ['PUT', '/v1/iam/realms/{realmId}', 'iamUpdateRealm'],
    ['GET', '/v1/iam/realms/{realmId}/users/{userId}', 'iamGetUser'],
    ['GET', '/v1/iam/realms/{realmId}/roles/{roleName}', 'iamGetRole'],
    ['DELETE', '/v1/iam/realms/{realmId}/roles/{roleName}', 'iamDeleteRole'],
  ];
  for (const [method, path, handler] of want) {
    const r = routes.find((x) => x.method === method && x.path === path);
    assert.ok(r, `route not registered: ${method} ${path}`);
    assert.equal(r.localHandler, handler);
    assert.equal(typeof HANDLERS[handler], 'function', `handler ${handler} missing`);
  }
});

test('bbx-iam-wire-01: getIamUser returns the user for the owning tenant (200)', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamGetUser(ctx(acmeOwner, { kcAdmin: kc, params: { realmId: REALM, userId: 'eu-1' } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.username, 'alice');
  assert.equal(res.body.realmRoles[0], 'app_user');
});

test('bbx-iam-wire-02: getIamUser 404 for an unknown user, 403 cross-tenant', async () => {
  const kc = fakeKc();
  const miss = await HANDLERS.iamGetUser(ctx(acmeOwner, { kcAdmin: kc, params: { realmId: REALM, userId: 'nope' } }));
  assert.equal(miss.statusCode, 404);
  const cross = await HANDLERS.iamGetUser(ctx(globexOwner, { kcAdmin: kc, params: { realmId: REALM, userId: 'eu-1' } }));
  assert.equal(cross.statusCode, 403);
});

test('bbx-iam-wire-03: getIamRole 200 then 404', async () => {
  const kc = fakeKc();
  const hit = await HANDLERS.iamGetRole(ctx(superadmin, { kcAdmin: kc, params: { realmId: REALM, roleName: 'editor' } }));
  assert.equal(hit.statusCode, 200);
  assert.equal(hit.body.name, 'editor');
  const miss = await HANDLERS.iamGetRole(ctx(superadmin, { kcAdmin: kc, params: { realmId: REALM, roleName: 'ghost' } }));
  assert.equal(miss.statusCode, 404);
});

test('bbx-iam-wire-04: deleteIamRole 200 (idempotent)', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamDeleteRole(ctx(superadmin, { kcAdmin: kc, params: { realmId: REALM, roleName: 'editor' } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.ok(kc.calls.some((c) => c[0] === 'deleteRealmRole'));
});

test('bbx-iam-wire-05: listIamRealms returns every tenant realm', async () => {
  const res = await HANDLERS.iamListRealms(ctx(superadmin, { kcAdmin: fakeKc() }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 2);
  assert.ok(res.body.items.some((r) => r.realmId === REALM && r.tenantId === ACME));
});

test('bbx-iam-wire-06: getIamRealm includes login options for the owning tenant', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamGetRealm(ctx(acmeOwner, { kcAdmin: kc }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.realmId, REALM);
  assert.equal(res.body.tenantId, ACME);
  assert.equal(res.body.authConfig.loginWithEmailAllowed, true);
});

test('bbx-iam-wire-07: updateIamRealm toggles login options; cross-tenant denied', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamUpdateRealm(ctx(acmeOwner, { kcAdmin: kc, body: { registrationAllowed: true } }));
  assert.equal(res.statusCode, 200);
  assert.ok(kc.calls.some((c) => c[0] === 'setRealmAuthConfig' && c[2].registrationAllowed === true));
  const cross = await HANDLERS.iamUpdateRealm(ctx(globexOwner, { kcAdmin: kc, body: { registrationAllowed: true } }));
  assert.equal(cross.statusCode, 403);
});
