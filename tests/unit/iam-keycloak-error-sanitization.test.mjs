import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';
import {
  KEYCLOAK_ADMIN_SAFE_MESSAGE,
  KeycloakAdminError,
  safeKeycloakAdminMessage,
} from '../../deploy/kind/control-plane/kc-admin.mjs';

const RAW_BODY_TEXT = 'verbatim upstream body should stay server-side';

function rawKeycloak404(method, path) {
  const error = new Error(`keycloak ${method} ${path} -> 404: {"error":"${RAW_BODY_TEXT}","realm":"tenant-alpha"}`);
  error.statusCode = 404;
  error.kcStatus = 404;
  error.body = { error: RAW_BODY_TEXT, realm: 'tenant-alpha' };
  return error;
}

function assertSafeClientError(response, expectedCode) {
  assert.equal(response.statusCode, 404);
  assert.equal(response.body.code, expectedCode);
  assert.notEqual(response.body.code, 'KEYCLOAK_ADMIN_REQUEST_FAILED');
  assert.equal(response.body.message, KEYCLOAK_ADMIN_SAFE_MESSAGE);
  assert.doesNotMatch(response.body.message, /keycloak\s/i);
  assert.doesNotMatch(response.body.message, /\/realms\//i);
  assert.doesNotMatch(response.body.message, /tenant-alpha/i);
  assert.doesNotMatch(response.body.message, new RegExp(RAW_BODY_TEXT, 'i'));
}

function tenantPool() {
  return {
    async query(sql, params) {
      if (/FROM tenants WHERE iam_realm = \$1/.test(sql)) {
        assert.deepEqual(params, ['tenant-alpha']);
      } else if (/FROM tenants WHERE id = \$1 OR slug = \$1/.test(sql)) {
        assert.deepEqual(params, ['tenant-alpha']);
      } else {
        assert.fail(`unexpected tenant lookup SQL: ${sql}`);
      }
      return {
        rows: [{
          id: 'tenant-alpha',
          tenant_id: 'tenant-alpha',
          slug: 'alpha',
          display_name: 'Tenant Alpha',
          status: 'active',
          iam_realm: 'tenant-alpha',
        }],
      };
    },
  };
}

test('KeycloakAdminError keeps upstream diagnostics out of enumerable client-facing fields', () => {
  const upstreamBody = { error: RAW_BODY_TEXT, realm: 'tenant-alpha' };
  const error = new KeycloakAdminError({
    method: 'POST',
    path: '/realms/tenant-alpha/users/missing-user/role-mappings/realm',
    status: 404,
    statusCode: 404,
    body: upstreamBody,
  });

  assert.equal(error.message, KEYCLOAK_ADMIN_SAFE_MESSAGE);
  assert.equal(safeKeycloakAdminMessage(error), KEYCLOAK_ADMIN_SAFE_MESSAGE);
  assert.match(error.diagnosticMessage, /keycloak POST \/realms\/tenant-alpha\/users/);
  assert.deepEqual(error.upstreamBody, upstreamBody);

  const serialized = JSON.stringify(error);
  assert.doesNotMatch(serialized, /\/realms\//);
  assert.doesNotMatch(serialized, /tenant-alpha/);
  assert.doesNotMatch(serialized, new RegExp(RAW_BODY_TEXT, 'i'));
});

test('superadmin IAM role assignment returns a sanitized domain error on upstream Keycloak 404', async () => {
  const response = await LOCAL_HANDLERS.iamAssignUserRoles({
    params: { realmId: 'tenant-alpha', userId: 'missing-user' },
    body: { roles: ['tenant_admin'] },
    identity: { sub: 'superadmin-1', actorType: 'superadmin' },
    kcAdmin: {
      async assignRealmRoles() {
        throw rawKeycloak404('POST', '/realms/tenant-alpha/users/missing-user/role-mappings/realm');
      },
    },
  });

  assertSafeClientError(response, 'IAM_ASSIGN_ROLE_FAILED');
});

test('tenant admin own-realm IAM mutation returns a sanitized domain error on upstream Keycloak 404', async () => {
  const response = await LOCAL_HANDLERS.iamSetUserStatus({
    pool: tenantPool(),
    params: { realmId: 'tenant-alpha', userId: 'missing-user' },
    body: { enabled: false },
    identity: { sub: 'tenant-admin-1', actorType: 'tenant_admin', tenantId: 'tenant-alpha' },
    kcAdmin: {
      async setUserEnabled() {
        throw rawKeycloak404('PUT', '/realms/tenant-alpha/users/missing-user');
      },
    },
  });

  assertSafeClientError(response, 'SET_USER_STATUS_FAILED');
});

test('superadmin tenant create realmExists preflight maps Keycloak failure to a sanitized domain error', async () => {
  const response = await LOCAL_HANDLERS.createTenant({
    pool: {},
    params: {},
    query: {},
    body: { displayName: 'Tenant Alpha', slug: 'tenant-alpha' },
    identity: { sub: 'superadmin-1', actorType: 'superadmin' },
    store: {
      async slugTaken(_pool, slug) {
        assert.equal(slug, 'tenant-alpha');
        return false;
      },
    },
    kcAdmin: {
      async realmExists(realm) {
        assert.match(realm, /^[0-9a-f-]{36}$/i);
        throw rawKeycloak404('GET', `/realms/${realm}`);
      },
    },
    async startSaga() {
      assert.fail('createTenant must not start the saga when realmExists fails');
    },
  });

  assertSafeClientError(response, 'CREATE_TENANT_FAILED');
});

test('superadmin IAM role list returns a sanitized domain error on upstream Keycloak 404', async () => {
  const response = await LOCAL_HANDLERS.iamListRoles({
    params: { realmId: 'tenant-alpha' },
    query: {},
    identity: { sub: 'superadmin-1', actorType: 'superadmin' },
    kcAdmin: {
      async listRealmRoles() {
        throw rawKeycloak404('GET', '/realms/tenant-alpha/roles');
      },
    },
  });

  assertSafeClientError(response, 'IAM_LIST_ROLES_FAILED');
});

test('tenant admin tenant-user list returns a sanitized domain error on upstream Keycloak 404', async () => {
  const response = await LOCAL_HANDLERS.listTenantUsers({
    pool: tenantPool(),
    params: { tenantId: 'tenant-alpha' },
    query: {},
    identity: { sub: 'tenant-admin-1', actorType: 'tenant_admin', tenantId: 'tenant-alpha' },
    kcAdmin: {
      async listUsers() {
        throw rawKeycloak404('GET', '/realms/tenant-alpha/users');
      },
    },
  });

  assertSafeClientError(response, 'IAM_LIST_TENANT_USERS_FAILED');
});

test('tenant admin own-realm IAM user list returns a sanitized domain error on upstream Keycloak 404', async () => {
  const response = await LOCAL_HANDLERS.iamListUsers({
    pool: tenantPool(),
    params: { realmId: 'tenant-alpha' },
    query: {},
    identity: { sub: 'tenant-admin-1', actorType: 'tenant_admin', tenantId: 'tenant-alpha' },
    kcAdmin: {
      async listUsers() {
        throw rawKeycloak404('GET', '/realms/tenant-alpha/users');
      },
    },
  });

  assertSafeClientError(response, 'IAM_LIST_USERS_FAILED');
});

test('superadmin IAM user-group list returns a sanitized domain error on upstream Keycloak 404', async () => {
  const response = await LOCAL_HANDLERS.iamListUserGroups({
    params: { realmId: 'tenant-alpha', userId: 'missing-user' },
    query: {},
    identity: { sub: 'superadmin-1', actorType: 'superadmin' },
    kcAdmin: {
      async listUserGroups() {
        throw rawKeycloak404('GET', '/realms/tenant-alpha/users/missing-user/groups');
      },
    },
  });

  assertSafeClientError(response, 'IAM_LIST_USER_GROUPS_FAILED');
});
