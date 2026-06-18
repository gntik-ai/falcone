/**
 * Black-box tests for app end-user lifecycle management
 * (add-enduser-lifecycle-management, #567 BUG-ENDUSER-MGMT, P1).
 *
 * The gap: the owner end-user surface was create+list only. `DELETE …/users/{id}`
 * and `PATCH …/users/{id}/status` were in the public route catalog but unrouted
 * (NO_ROUTE 404), so an owner could not disable or delete a registered app end-user.
 *
 * The fix wires `iamDeleteUser` + `iamSetUserStatus`, authorizing superadmin OR the
 * owner/admin of the tenant that OWNS the realm (never cross-tenant), then driving
 * Keycloak (delete / PUT enabled). Drives the canonical handlers (`HANDLERS`) with a
 * stub pool (realm→tenant lookup) and an injected `kcAdmin` so the full happy path,
 * the cross-tenant denial, and input validation are all asserted deterministically.
 *
 * bbx-567-01: owner of the realm's tenant can delete an end-user (calls KC delete)
 * bbx-567-02: owner can disable an end-user (status → enabled:false via KC)
 * bbx-567-03: a DIFFERENT tenant's owner is denied (403, no KC call) — no cross-tenant
 * bbx-567-04: superadmin may manage any realm
 * bbx-567-05: status PATCH with no enabled/state → 400 (before any KC call)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS as HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';

const REALM = 'acme29833';
const ACME = 'acme-78848e21';
const GLOBEX = 'globex-fe63fa39';

// Stub pool: getTenantByRealm resolves REALM -> the acme tenant.
const pool = {
  query: async (sql, args) => {
    if (/FROM\s+tenants\s+WHERE\s+iam_realm/i.test(sql)) {
      return args?.[0] === REALM ? { rows: [{ id: ACME, tenant_id: ACME, slug: 'acme', iam_realm: REALM }] } : { rows: [] };
    }
    return { rows: [] };
  },
};

// A recording fake Keycloak admin injected via ctx.kcAdmin.
function fakeKc() {
  const calls = [];
  return {
    calls,
    deleteUser: async (realm, userId) => { calls.push(['deleteUser', realm, userId]); },
    setUserEnabled: async (realm, userId, enabled) => { calls.push(['setUserEnabled', realm, userId, enabled]); },
  };
}

const ctx = (identity, { body = {}, userId = 'eu-1', kc } = {}) => ({
  pool, identity, body, kcAdmin: kc, params: { realmId: REALM, userId },
});

const acmeOwner = { actorType: 'tenant_owner', tenantId: ACME };
const globexOwner = { actorType: 'tenant_owner', tenantId: GLOBEX };
const superadmin = { actorType: 'superadmin' };

test('bbx-567-01: realm owner deletes an end-user', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamDeleteUser(ctx(acmeOwner, { kc }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.deepEqual(kc.calls, [['deleteUser', REALM, 'eu-1']]);
});

test('bbx-567-02: realm owner disables an end-user', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamSetUserStatus(ctx(acmeOwner, { kc, body: { enabled: false } }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, false);
  assert.equal(res.body.state, 'suspended');
  assert.deepEqual(kc.calls, [['setUserEnabled', REALM, 'eu-1', false]]);
});

test('bbx-567-03: a different tenant owner is denied (no cross-tenant)', async () => {
  const kc = fakeKc();
  const del = await HANDLERS.iamDeleteUser(ctx(globexOwner, { kc }));
  assert.equal(del.statusCode, 403);
  const status = await HANDLERS.iamSetUserStatus(ctx(globexOwner, { kc, body: { enabled: false } }));
  assert.equal(status.statusCode, 403);
  assert.equal(kc.calls.length, 0, 'must not reach Keycloak on a cross-tenant attempt');
});

test('bbx-567-04: superadmin may manage any realm', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamDeleteUser(ctx(superadmin, { kc }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(kc.calls, [['deleteUser', REALM, 'eu-1']]);
});

test('bbx-567-05: status PATCH without enabled/state → 400', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamSetUserStatus(ctx(superadmin, { kc, body: {} }));
  assert.equal(res.statusCode, 400);
  assert.equal(kc.calls.length, 0);
});
