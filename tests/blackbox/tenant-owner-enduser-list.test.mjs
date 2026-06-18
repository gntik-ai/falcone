/**
 * Black-box tests for add-tenant-owner-enduser-management (P1, live E2E re-run
 * 2026-06-18 BUG-ENDUSER-OWNER-403).
 *
 * Gap: a tenant_owner could NOT list its own app end-users — `GET /v1/iam/realms/{id}/users`
 * was superadmin-only (403). The owner could already delete/disable them (#567), but not
 * list them, so there was no usable owner-facing end-user management surface.
 *
 * Fix: `iamListUsers` authorizes superadmin OR the owner/admin of the tenant that OWNS the
 * realm (authorizeRealmManage), and the route is `authenticated` (handler authorizes). A
 * different tenant's owner is denied (no cross-tenant).
 *
 * Mirrors the #567 harness: drives LOCAL_HANDLERS with a stub pool (realm→tenant) + an
 * injected ctx.kcAdmin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS as HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';

const REALM = 'acme29833';
const ACME = 'acme-78848e21';
const GLOBEX = 'globex-fe63fa39';

const pool = {
  query: async (sql, args) => {
    if (/FROM\s+tenants\s+WHERE\s+iam_realm/i.test(sql)) {
      return args?.[0] === REALM ? { rows: [{ id: ACME, tenant_id: ACME, slug: 'acme', iam_realm: REALM }] } : { rows: [] };
    }
    return { rows: [] };
  },
};

function fakeKc() {
  const calls = [];
  return {
    calls,
    listUsers: async (realm, opts) => { calls.push(['listUsers', realm, opts?.max]); return [{ id: 'eu-1', username: 'alice', email: 'a@x.io', enabled: true }]; },
    listUserRealmRoles: async () => [{ name: 'app_user' }],
  };
}

const ctx = (identity, { kc } = {}) => ({ pool, identity, query: {}, kcAdmin: kc, params: { realmId: REALM } });

const acmeOwner = { actorType: 'tenant_owner', tenantId: ACME };
const globexOwner = { actorType: 'tenant_owner', tenantId: GLOBEX };
const superadmin = { actorType: 'superadmin' };

test('bbx-eu-list-01: realm owner lists its OWN app end-users (200)', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamListUsers(ctx(acmeOwner, { kc }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].username, 'alice');
  assert.equal(res.body.items[0].realmRoles[0], 'app_user');
  assert.deepEqual(kc.calls[0].slice(0, 1), ['listUsers']);
});

test('bbx-eu-list-02: a DIFFERENT tenant owner is denied (403, no Keycloak call)', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamListUsers(ctx(globexOwner, { kc }));
  assert.equal(res.statusCode, 403);
  assert.equal(kc.calls.length, 0, 'must not reach Keycloak on a cross-tenant attempt');
});

test('bbx-eu-list-03: superadmin may list any realm', async () => {
  const kc = fakeKc();
  const res = await HANDLERS.iamListUsers(ctx(superadmin, { kc }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length, 1);
});
