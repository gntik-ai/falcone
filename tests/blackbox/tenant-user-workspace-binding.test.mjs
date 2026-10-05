// #1016: admin-created principals use validated bindings in post-#961 realms.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { KEYCLOAK_ADMIN_SAFE_MESSAGE } from '../../apps/control-plane/kc-admin.mjs';

const TENANT = { id: 'tenant-own', slug: 'own', iam_realm: 'tenant-own' };
const OWN = { id: 'workspace-own', slug: 'default', tenant_id: TENANT.id };
const FOREIGN = { id: 'workspace-foreign', slug: 'default', tenant_id: 'tenant-other' };
const owner = { actorType: 'tenant_owner', tenantId: TENANT.id };

function fixture({ tenant = TENANT, workspaces = [OWN], identity = owner,
  body = {}, returnedWorkspace, failure, failAt = 'createUser' } = {}) {
  const calls = [];
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM tenants\b/.test(sql)) {
        return { rows: tenant && [tenant.id, tenant.slug].includes(params[0]) ? [tenant] : [] };
      }
      if (/FROM workspaces\b/.test(sql)) {
        // Mirror the actual scoped SQL and id precedence, with foreign/impostor rows first.
        assert.match(sql, /tenant_id = \$2/);
        assert.match(sql, /ORDER BY \(id = \$1\) DESC/);
        if (returnedWorkspace) return { rows: [returnedWorkspace] };
        const matches = workspaces.filter((w) => w.tenant_id === params[1]
          && (w.id === params[0] || w.slug === params[0]));
        matches.sort((a, b) => (b.id === params[0]) - (a.id === params[0]));
        return { rows: matches.slice(0, 1) };
      }
      throw new Error('unexpected store query');
    },
  };
  const kcAdmin = {
    async createUser(realm, opts) {
      calls.push({ method: 'createUser', realm, opts });
      if (failure && failAt === 'createUser') throw failure;
      return 'created-user';
    },
    async assignRealmRoles(realm, userId, roles) {
      calls.push({ method: 'assignRealmRoles', realm, userId, roles });
      if (failure && failAt === 'assignRealmRoles') throw failure;
    },
  };
  return {
    calls, queries,
    ctx: { pool, kcAdmin, identity, params: { tenantId: TENANT.slug }, body: { username: 'new-user', ...body } },
  };
}

const workspaceQueries = (f) => f.queries.filter(({ sql }) => /FROM workspaces\b/.test(sql));

test('authorized superadmin, owner and admin stamp canonical workspace bindings by id or slug', async () => {
  for (const identity of [{ actorType: 'superadmin' }, owner,
    { actorType: 'tenant_admin', tenantId: TENANT.id }]) {
    for (const workspaceId of [OWN.id, OWN.slug]) {
      const f = fixture({ identity, body: { workspaceId,
        attributes: { tenant_id: FOREIGN.tenant_id, workspace_id: FOREIGN.id } } });
      const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
      assert.deepEqual(result, { statusCode: 201, body: {
        userId: 'created-user', username: 'new-user', realm: TENANT.iam_realm,
        roles: ['tenant_developer'], workspaceId: OWN.id, principalScope: 'workspace',
      } });
      assert.deepEqual(f.calls[0], { method: 'createUser', realm: TENANT.iam_realm, opts: {
        username: 'new-user', email: null, firstName: null, lastName: null,
        password: null, temporary: true, attributes: { tenant_id: TENANT.id, workspace_id: OWN.id },
      } });
      assert.deepEqual(f.calls[1], { method: 'assignRealmRoles', realm: TENANT.iam_realm,
        userId: 'created-user', roles: ['tenant_developer'] });
      assert.deepEqual(workspaceQueries(f)[0].params, [workspaceId, TENANT.id]);
    }
  }
});

test('omitting workspaceId explicitly creates a tenant principal and ignores caller attributes', async () => {
  const f = fixture({ body: { attributes: { workspace_id: FOREIGN.id, tenant_id: FOREIGN.tenant_id } } });
  const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.workspaceId, null);
  assert.equal(result.body.principalScope, 'tenant');
  assert.deepEqual(f.calls[0].opts.attributes, { tenant_id: TENANT.id });
  assert.deepEqual(workspaceQueries(f), []);
  assert.equal(f.calls.length, 2);
});

test('foreign and unknown workspace bindings return identical errors with no Keycloak calls', async () => {
  const responses = [];
  for (const workspaceId of [FOREIGN.id, 'workspace-unknown']) {
    const f = fixture({ workspaces: [FOREIGN, OWN], body: { workspaceId } });
    responses.push(await LOCAL_HANDLERS.createTenantUser(f.ctx));
    assert.deepEqual(f.calls, []);
  }
  assert.deepEqual(responses[0], { statusCode: 400, body: {
    code: 'WORKSPACE_NOT_IN_TENANT', message: 'workspaceId does not identify a workspace of this tenant',
  } });
  assert.deepEqual(responses[1], responses[0]);
});

test('tenant ownership is re-checked even if the scoped store returns a foreign row', async () => {
  const f = fixture({ returnedWorkspace: FOREIGN, body: { workspaceId: FOREIGN.id } });
  const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
  assert.equal(result.statusCode, 400);
  assert.equal(result.body.code, 'WORKSPACE_NOT_IN_TENANT');
  assert.deepEqual(f.calls, []);
});

test('non-string, empty and whitespace-only workspaceId fail before lookup or Keycloak', async () => {
  for (const workspaceId of [null, false, 42, [], {}, '', ' \t\n']) {
    const f = fixture({ body: { workspaceId } });
    const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.code, 'VALIDATION_ERROR');
    assert.deepEqual(workspaceQueries(f), []);
    assert.deepEqual(f.calls, []);
  }
});

test('a shared slug resolves within the authorized tenant', async () => {
  const f = fixture({ workspaces: [FOREIGN, OWN], body: { workspaceId: 'default' } });
  const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.workspaceId, OWN.id);
  assert.deepEqual(f.calls[0].opts.attributes, { tenant_id: TENANT.id, workspace_id: OWN.id });
});

test('a canonical id wins over a same-tenant slug impostor', async () => {
  const impostor = { id: 'workspace-impostor', slug: OWN.id, tenant_id: TENANT.id };
  const f = fixture({ workspaces: [impostor, OWN], body: { workspaceId: OWN.id } });
  const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
  assert.equal(result.statusCode, 201);
  assert.equal(result.body.workspaceId, OWN.id);
  assert.equal(f.calls[0].opts.attributes.workspace_id, OWN.id);
});

test('authorization is checked before workspace validation or resolution', async () => {
  for (const identity of [{ actorType: 'tenant_owner', tenantId: FOREIGN.tenant_id },
    { actorType: 'tenant_admin', tenantId: FOREIGN.tenant_id },
    { actorType: 'tenant_developer', tenantId: TENANT.id }]) {
    for (const workspaceId of [OWN.id, FOREIGN.id, 'unknown', null]) {
      const f = fixture({ identity, body: { workspaceId } });
      const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
      assert.deepEqual(result, { statusCode: 403, body: {
        code: 'FORBIDDEN', message: 'requires superadmin or tenant owner/admin of this tenant',
      } });
      assert.deepEqual(workspaceQueries(f), []);
      assert.deepEqual(f.calls, []);
    }
  }
});

test('tenant, username and role errors retain their behavior before workspace resolution', async () => {
  for (const [opts, expected] of [
    [{ tenant: null }, { statusCode: 404, body: { code: 'TENANT_NOT_FOUND', message: 'tenant own not found' } }],
    [{ body: { username: null } }, { statusCode: 400, body: {
      code: 'VALIDATION_ERROR', message: 'username or email is required',
    } }],
    [{ body: { roles: ['not-a-role'] } }, { statusCode: 400, body: {
      code: 'INVALID_ROLE', message: 'unknown realm roles: not-a-role',
    } }],
  ]) {
    const f = fixture({ ...opts, body: { workspaceId: OWN.id, ...opts.body } });
    assert.deepEqual(await LOCAL_HANDLERS.createTenantUser(f.ctx), expected);
    assert.deepEqual(workspaceQueries(f), []);
    assert.deepEqual(f.calls, []);
  }
});

test('email fallback, supplied roles and default role behavior remain unchanged', async () => {
  for (const roles of [undefined, [], ['tenant_admin']]) {
    const f = fixture({ body: { username: null, email: 'member@example.test', roles } });
    const result = await LOCAL_HANDLERS.createTenantUser(f.ctx);
    const expectedRoles = roles?.length ? roles : ['tenant_developer'];
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.username, 'member@example.test');
    assert.deepEqual(result.body.roles, expectedRoles);
    assert.deepEqual(f.calls[1].roles, expectedRoles);
  }
});

test('Keycloak create and role-assignment errors retain safe kcBackedErr mapping', async () => {
  for (const failAt of ['createUser', 'assignRealmRoles']) {
    for (const [failure, statusCode, message] of [
      [Object.assign(new Error('upstream diagnostic'), { kcStatus: 409 }), 409, KEYCLOAK_ADMIN_SAFE_MESSAGE],
      [Object.assign(new Error('upstream diagnostic'), { kcStatus: 500 }), 502, KEYCLOAK_ADMIN_SAFE_MESSAGE],
      [Object.assign(new Error('request rejected'), { statusCode: 422 }), 422, 'request rejected'],
    ]) {
      const f = fixture({ failAt, failure, body: { workspaceId: OWN.id } });
      assert.deepEqual(await LOCAL_HANDLERS.createTenantUser(f.ctx), {
        statusCode, body: { code: 'CREATE_USER_FAILED', message },
      });
      assert.equal(f.calls.length, failAt === 'createUser' ? 1 : 2);
    }
  }
});
