import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

function fakeKc() {
  const calls = [];
  return {
    calls,
    async createRealmRole(realm, roleName) {
      calls.push(['createRealmRole', realm, roleName]);
    },
  };
}

function ctx(body, kc = fakeKc()) {
  return {
    kcAdmin: kc,
    params: { realmId: 'in-falcone-platform' },
    body,
    identity: { sub: 'superadmin-1', actorType: 'superadmin' },
  };
}

test('iamCreateRole applies documented roleName payload', async () => {
  const kc = fakeKc();

  const res = await LOCAL_HANDLERS.iamCreateRole(ctx({ roleName: 'security_auditor' }, kc));

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.roleName, 'security_auditor');
  assert.equal(res.body.name, 'security_auditor');
  assert.deepEqual(kc.calls, [['createRealmRole', 'in-falcone-platform', 'security_auditor']]);
});

test('iamCreateRole trims documented roleName and preserves legacy name compatibility', async () => {
  const roleNameKc = fakeKc();
  const roleNameRes = await LOCAL_HANDLERS.iamCreateRole(ctx({ roleName: '  tenant_operator  ' }, roleNameKc));

  assert.equal(roleNameRes.statusCode, 201, JSON.stringify(roleNameRes.body));
  assert.equal(roleNameRes.body.roleName, 'tenant_operator');
  assert.deepEqual(roleNameKc.calls, [['createRealmRole', 'in-falcone-platform', 'tenant_operator']]);

  const legacyKc = fakeKc();
  const legacyRes = await LOCAL_HANDLERS.iamCreateRole(ctx({ name: 'legacy_operator' }, legacyKc));

  assert.equal(legacyRes.statusCode, 201, JSON.stringify(legacyRes.body));
  assert.equal(legacyRes.body.roleName, 'legacy_operator');
  assert.deepEqual(legacyKc.calls, [['createRealmRole', 'in-falcone-platform', 'legacy_operator']]);
});

test('iamCreateRole rejects missing roleName before mutating Keycloak', async () => {
  const kc = fakeKc();

  const res = await LOCAL_HANDLERS.iamCreateRole(ctx({ roleName: '   ' }, kc));

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(res.body.message, 'roleName required');
  assert.equal(kc.calls.length, 0);
});
