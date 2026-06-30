import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';
import { normalizeKeycloakAttributes } from '../../deploy/kind/control-plane/kc-admin.mjs';

function fakeKc() {
  const calls = [];
  return {
    calls,
    async createUser(realm, opts) {
      calls.push(['createUser', realm, opts]);
      return 'user-contract-1';
    },
    async assignRealmRoles(realm, userId, roles) {
      calls.push(['assignRealmRoles', realm, userId, roles]);
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

test('iamCreateUser applies documented attributes, realmRoles, and bootstrapCredentials', async () => {
  const kc = fakeKc();
  const body = {
    username: 'tenant-owner',
    email: 'tenant-owner@example.com',
    firstName: 'Tenant',
    lastName: 'Owner',
    realmRoles: ['tenant_owner'],
    bootstrapCredentials: {
      temporaryPassword: 'CorrectHorse12',
      requiredActions: [],
    },
    attributes: {
      tenant_id: ['tenant-123'],
      workspace_id: ['workspace-456'],
    },
  };

  const res = await LOCAL_HANDLERS.iamCreateUser(ctx(body, kc));

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.deepEqual(res.body.realmRoles, ['tenant_owner']);
  assert.deepEqual(res.body.attributes, body.attributes);

  const createCall = kc.calls.find((call) => call[0] === 'createUser');
  assert.ok(createCall, 'createUser must be called');
  assert.equal(createCall[1], 'in-falcone-platform');
  assert.deepEqual(createCall[2], {
    username: 'tenant-owner',
    email: 'tenant-owner@example.com',
    firstName: 'Tenant',
    lastName: 'Owner',
    password: 'CorrectHorse12',
    temporary: false,
    enabled: true,
    emailVerified: true,
    requiredActions: [],
    attributes: body.attributes,
  });

  const roleCall = kc.calls.find((call) => call[0] === 'assignRealmRoles');
  assert.deepEqual(roleCall, ['assignRealmRoles', 'in-falcone-platform', 'user-contract-1', ['tenant_owner']]);
});

test('iamCreateUser still accepts legacy roles and credentials payloads', async () => {
  const kc = fakeKc();
  const res = await LOCAL_HANDLERS.iamCreateUser(ctx({
    username: 'legacy-user',
    roles: ['tenant_admin'],
    credentials: [{ type: 'password', value: 'LegacySecret12', temporary: true }],
  }, kc));

  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  const createCall = kc.calls.find((call) => call[0] === 'createUser');
  assert.equal(createCall[2].password, 'LegacySecret12');
  assert.equal(createCall[2].temporary, true);
  assert.deepEqual(kc.calls.find((call) => call[0] === 'assignRealmRoles'), [
    'assignRealmRoles',
    'in-falcone-platform',
    'user-contract-1',
    ['tenant_admin'],
  ]);
});

test('iamCreateUser rejects create fields it cannot apply instead of returning 201 and dropping them', async () => {
  const kc = fakeKc();
  const res = await LOCAL_HANDLERS.iamCreateUser(ctx({
    username: 'grouped-user',
    groups: ['/operators'],
    metadata: { source: 'test' },
    bootstrapCredentials: {
      temporaryPassword: 'CorrectHorse12',
      sendEmail: true,
    },
  }, kc));

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'UNSUPPORTED_FIELD');
  assert.match(res.body.message, /groups/);
  assert.match(res.body.message, /metadata/);
  assert.match(res.body.message, /bootstrapCredentials\.sendEmail/);
  assert.equal(kc.calls.length, 0, 'unsupported documented fields must fail before Keycloak mutation');
});

test('normalizeKeycloakAttributes preserves OpenAPI multi-value attributes and scalar compatibility', () => {
  assert.deepEqual(normalizeKeycloakAttributes({
    tenant_id: ['tenant-123'],
    locale: ['es-ES', 'ca-ES'],
    legacy_scalar: 'single',
  }), {
    tenant_id: ['tenant-123'],
    locale: ['es-ES', 'ca-ES'],
    legacy_scalar: ['single'],
  });
});
