import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { kcAdmin, KeycloakAdminError } from '../../apps/control-plane/kc-admin.mjs';
import { startMetricsServer, TENANT } from './helpers/control-plane-metrics-server.mjs';

const W = 'workspace-one';
const REALM = 'tenant-one';
const ROLE = 'workspace_service_account';

function fixture({ fail, enable = 'success', cleanupFails = false, roles = [ROLE] } = {}) {
  const calls = [];
  const state = { enabled: false, row: null, deleted: false };
  const step = (name) => { calls.push(name); if (fail === name) throw new KeycloakAdminError({ body: 'private-provider-data' }); };
  const kc = {
    findClient: async () => null,
    createConfidentialClient: async (realm, input) => {
      step('create'); assert.equal(realm, REALM); state.createdInput = input;
      state.enabled = input.enabled; return 'client-one';
    },
    ensureTenantAudienceMapper: async () => step('audience'),
    createRealmRole: async (realm, role) => { step('role'); assert.equal(realm, REALM); assert.equal(role, ROLE); },
    ensureWorkspaceIdMapper: async (realm, uuid, workspace) => {
      step('mapper'); assert.deepEqual([realm, uuid, workspace], [REALM, 'client-one', W]);
    },
    listClientDefaultScopes: async () => { step('default-scopes'); return [{ id: 'ws-default', name: 'workspace-context' }]; },
    listClientOptionalScopes: async () => { step('optional-scopes'); return [{ id: 'ws-optional', name: 'workspace-context' }]; },
    removeClientDefaultScope: async (realm, uuid, scope) => { step('remove-default'); assert.equal(scope, 'ws-default'); },
    removeClientOptionalScope: async (realm, uuid, scope) => { step('remove-optional'); assert.equal(scope, 'ws-optional'); },
    inspectWorkspaceClaimSources: async (realm, uuid, workspace) => { step('inspect'); assert.equal(workspace, W); },
    getServiceAccountUser: async () => { step('sa-user'); return { id: 'user-one' }; },
    assignRealmRoles: async (realm, userId, roleNames) => { step('assign'); assert.deepEqual([realm, userId, roleNames], [REALM, 'user-one', [ROLE]]); },
    listEffectiveRealmRoles: async () => { step('effective'); return roles.map(name => ({ name })); },
    setClientEnabled: async (_realm, _uuid, enabled) => {
      step(enabled ? 'enable' : 'disable');
      if (!enabled && ['unknown', 'unknown-delete-ok'].includes(enable)) throw new KeycloakAdminError();
      if (enabled && enable === 'no-commit') throw new KeycloakAdminError();
      state.enabled = enabled;
      if (enabled && enable !== 'success') throw new KeycloakAdminError();
    },
    getClient: async () => { step('re-read'); if (enable.startsWith('unknown')) throw new KeycloakAdminError(); return { enabled: state.enabled }; },
    deleteClient: async () => { step('delete'); if (cleanupFails) throw new KeycloakAdminError({ body: 'private-cleanup-data' }); state.deleted = true; state.enabled = false; },
  };
  const ctx = {
    identity: { sub: 'owner-one', actorType: 'tenant_owner', tenantId: REALM },
    params: { workspaceId: W }, body: { displayName: 'Worker', workspaceId: 'other' }, kcAdmin: kc,
    store: {
      getWorkspace: async () => ({ id: W, slug: 'dev', tenant_id: REALM }),
      getTenant: async () => ({ iam_realm: REALM }),
    },
    pool: { query: async (sql, values) => {
      if (sql.includes('INSERT INTO service_accounts')) {
        step('insert'); assert.equal(values[1], W);
        state.row = { id: values[0], workspace_id: values[1], kc_client_id: values[4] };
        if (fail === 'insert-commit') throw new Error('registry acknowledgement lost');
        return { rows: [state.row] };
      }
      if (sql.includes('DELETE FROM service_accounts')) { step('remove-row'); state.row = null; return { rows: [] }; }
      assert.fail('unexpected registry operation');
    } },
  };
  return { ctx, kc, calls, state };
}

test('new SA is bound to the resolved workspace and enabled only after verification and registry insert', async () => {
  const { ctx, calls, state } = fixture();
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.statusCode, 201);
  assert.equal(state.createdInput.enabled, false);
  assert.deepEqual(calls, ['create', 'audience', 'role', 'mapper', 'default-scopes', 'remove-default',
    'optional-scopes', 'remove-optional', 'inspect', 'sa-user', 'assign', 'effective', 'insert', 'enable']);
  assert.equal(state.enabled, true);
  assert.equal(state.row.workspace_id, W);
});

function keycloakHttp(t, handle) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (url.endsWith('/protocol/openid-connect/token')) {
      return Response.json({ access_token: 'fixture-token', expires_in: 300 });
    }
    const request = { path: new URL(url).pathname.split('/admin')[1], method: init.method,
      body: init.body ? JSON.parse(init.body) : undefined };
    requests.push(request);
    return handle(request);
  });
  return requests;
}

test('confidential clients default to enabled, but SA provisioning can explicitly keep them disabled', async t => {
  const requests = keycloakHttp(t, () => new Response(null, { status: 201, headers: { location: 'http://fixture/clients/client-one' } }));
  await kcAdmin.createConfidentialClient(REALM, { clientId: 'app' });
  await kcAdmin.createConfidentialClient(REALM, { clientId: 'sa', enabled: false });
  assert.deepEqual(requests.map(r => r.body.enabled), [true, false]);
});

function workspaceMapper(workspace = W) {
  return { name: 'workspace_id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
    config: { 'claim.name': 'workspace_id', 'claim.value': workspace, 'jsonType.label': 'String',
      'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true' } };
}

test('workspace mapper is created once, read-only on retry, and rejects mismatches without writing', async t => {
  const mappers = [];
  const requests = keycloakHttp(t, r => {
    assert.equal(r.path, `/realms/${REALM}/clients/client-one/protocol-mappers/models`);
    if (r.method === 'GET') return Response.json(mappers);
    assert.equal(r.method, 'POST'); mappers.push(r.body); return new Response(null, { status: 201 });
  });
  assert.deepEqual(await kcAdmin.ensureWorkspaceIdMapper(REALM, 'client-one', W), { created: true });
  assert.deepEqual(mappers, [workspaceMapper()]);
  assert.deepEqual(await kcAdmin.ensureWorkspaceIdMapper(REALM, 'client-one', W), { created: false });
  const invalid = [workspaceMapper('other'), { ...workspaceMapper(), protocolMapper: 'oidc-usermodel-attribute-mapper' },
    { ...workspaceMapper(), config: { ...workspaceMapper().config, 'access.token.claim': 'false' } },
    { ...workspaceMapper(), config: { ...workspaceMapper().config, 'multivalued': 'true' } }];
  for (const mapper of invalid) {
    mappers.splice(0, mappers.length, mapper);
    await assert.rejects(() => kcAdmin.ensureWorkspaceIdMapper(REALM, 'client-one', W), /mismatch/);
  }
  mappers.splice(0, mappers.length, workspaceMapper(), workspaceMapper());
  await assert.rejects(() => kcAdmin.ensureWorkspaceIdMapper(REALM, 'client-one', W), /mismatch/);
  assert.equal(requests.filter(r => r.method === 'POST').length, 1);
});

for (const location of ['client', 'default', 'optional']) {
  test(`inspection checks every ${location} mapper and fails closed on token-shaping conflicts`, async t => {
    let extra = [];
    const requests = keycloakHttp(t, r => {
      const base = `/realms/${REALM}/clients/client-one`;
      assert.equal(r.method, 'GET');
      if (r.path === `${base}/protocol-mappers/models`) return Response.json([workspaceMapper(), ...(location === 'client' ? extra : [])]);
      if (r.path === `${base}/default-client-scopes`) return Response.json([{ id: 'scope-default', name: 'custom-ws' }]);
      if (r.path === `${base}/optional-client-scopes`) return Response.json([{ id: 'scope-optional', name: 'custom-optional' }]);
      if (r.path === `/realms/${REALM}/client-scopes/scope-default/protocol-mappers/models`) return Response.json(location === 'default' ? extra : []);
      if (r.path === `/realms/${REALM}/client-scopes/scope-optional/protocol-mappers/models`) return Response.json(location === 'optional' ? extra : []);
      assert.fail(`unexpected request ${r.path}`);
    });
    await kcAdmin.inspectWorkspaceClaimSources(REALM, 'client-one', W);
    for (const claim of ['workspace_id', 'workspace_ids', 'realm_access', 'resource_access', 'roles', 'actor_type']) {
      extra = [{ name: `custom-${claim}`, protocol: 'openid-connect', protocolMapper: 'oidc-usermodel-attribute-mapper', config: { 'claim.name': claim } }];
      await assert.rejects(() => kcAdmin.inspectWorkspaceClaimSources(REALM, 'client-one', W));
    }
    for (const protocolMapper of ['oidc-hardcoded-role-mapper', 'oidc-role-name-mapper']) {
      extra = [{ name: 'privileged-role', protocolMapper, config: { role: 'platform_admin' } }];
      await assert.rejects(() => kcAdmin.inspectWorkspaceClaimSources(REALM, 'client-one', W));
    }
    extra = [workspaceMapper()];
    await assert.rejects(() => kcAdmin.inspectWorkspaceClaimSources(REALM, 'client-one', W));
    assert.ok(requests.some(r => r.path.includes('/scope-default/protocol-mappers')));
    assert.ok(requests.some(r => r.path.includes('/scope-optional/protocol-mappers')));
  });
}

test('client scope removal, SA lookup and effective roles use the Keycloak admin boundaries', async t => {
  const requests = keycloakHttp(t, r => {
    if (r.method === 'DELETE') return new Response(null, { status: 204 });
    if (r.path.endsWith('/service-account-user')) return Response.json({ id: 'sa-user' });
    if (r.path.endsWith('/role-mappings/realm/composite')) return Response.json([{ name: ROLE }, { name: 'platform_admin' }]);
    assert.fail(`unexpected request ${r.path}`);
  });
  await kcAdmin.removeClientDefaultScope(REALM, 'client-one', 'scope-one');
  await kcAdmin.removeClientOptionalScope(REALM, 'client-one', 'scope-two');
  assert.deepEqual(await kcAdmin.getServiceAccountUser(REALM, 'client-one'), { id: 'sa-user' });
  assert.deepEqual(await kcAdmin.listEffectiveRealmRoles(REALM, 'sa-user'), [{ name: ROLE }, { name: 'platform_admin' }]);
  assert.deepEqual(requests.map(r => [r.method, r.path]), [
    ['DELETE', `/realms/${REALM}/clients/client-one/default-client-scopes/scope-one`],
    ['DELETE', `/realms/${REALM}/clients/client-one/optional-client-scopes/scope-two`],
    ['GET', `/realms/${REALM}/clients/client-one/service-account-user`],
    ['GET', `/realms/${REALM}/users/sa-user/role-mappings/realm/composite`],
  ]);
});

for (const fail of ['audience', 'role', 'mapper', 'default-scopes', 'remove-default', 'optional-scopes',
  'remove-optional', 'inspect', 'sa-user', 'assign', 'effective', 'insert']) {
  test(`failure at ${fail} deletes the disabled client and leaves no registry entry`, async () => {
    const { ctx, calls, state } = fixture({ fail });
    const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
    assert.equal(result.body.code, 'CREATE_SA_FAILED');
    assert.ok(calls.includes('delete'));
    assert.ok(!calls.includes('enable'));
    assert.equal(state.enabled, false);
    assert.equal(state.row, null);
    assert.ok(!JSON.stringify(result).includes('private-provider-data'));
  });
}

test('deletion failure after assigning roles is logged and surfaced while the client remains disabled', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const { ctx, calls, state } = fixture({ fail: 'effective', cleanupFails: true });
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.body.code, 'CREATE_SA_FAILED');
  assert.ok(calls.includes('assign'));
  assert.equal(state.enabled, false);
  assert.equal(state.row, null);
  assert.equal(result.body.cleanupErrors[0].operation, 'deleteClient');
  assert.equal(logs.length, 1);
  assert.ok(!JSON.stringify([result, logs]).includes('private-cleanup-data'));
});

for (const source of ['tenant_admin', 'group', 'composite', 'default roles']) {
  test(`effective privileged role inherited via ${source} rejects creation`, async () => {
    const { ctx, calls, state } = fixture({ roles: [ROLE, source === 'tenant_admin' ? 'tenant_admin' : 'platform_admin', `default-roles-${REALM}`] });
    const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
    assert.equal(result.body.code, 'CREATE_SA_FAILED');
    assert.ok(calls.includes('delete'));
    assert.ok(!calls.includes('enable'));
    assert.equal(state.row, null);
  });
}

test('only the four allowlisted effective roles may accompany the workspace grant', async () => {
  const { ctx } = fixture({ roles: [ROLE, 'offline_access', 'uma_authorization', `default-roles-${REALM}`] });
  assert.equal((await LOCAL_HANDLERS.createServiceAccount(ctx)).statusCode, 201);
});

test('enable commits then throws: re-read confirms success and keeps the registry without deletion', async () => {
  const { ctx, calls, state } = fixture({ enable: 'commit', cleanupFails: true });
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.statusCode, 201);
  assert.equal(state.enabled, true);
  assert.ok(state.row);
  assert.deepEqual(calls.slice(-2), ['enable', 're-read']);
  assert.ok(!calls.includes('delete'));
});

for (const cleanupFails of [false, true]) {
  test(`enable throws without committing: removes registry, stays disabled (deletion fails: ${cleanupFails})`, async t => {
    t.mock.method(console, 'error', () => {});
    const { ctx, calls, state } = fixture({ enable: 'no-commit', cleanupFails });
    const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
    assert.equal(result.body.code, 'CREATE_SA_FAILED');
    assert.equal(state.row, null);
    assert.equal(state.enabled, false);
    assert.ok(calls.indexOf('re-read') < calls.indexOf('delete'));
    if (cleanupFails) assert.equal(result.body.cleanupErrors[0].operation, 'deleteClient');
  });
}

test('unknown enable with failed re-read, disable and delete preserves the registry and flags operator review', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const { ctx, calls, state } = fixture({ enable: 'unknown', cleanupFails: true });
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.body.code, 'CREATE_SA_FAILED');
  assert.equal(state.enabled, true);
  assert.ok(state.row);
  assert.equal(result.body.needsOperatorReview, true);
  assert.equal(result.body.serviceAccountId, state.row.id);
  assert.deepEqual(calls.slice(-4), ['enable', 're-read', 'disable', 'delete']);
  assert.deepEqual(result.body.cleanupErrors.map(e => e.operation), ['getClient', 'setClientEnabled(false)', 'deleteClient']);
  assert.ok(logs.length > 0);
  assert.ok(!JSON.stringify([result, logs]).includes('private-cleanup-data'));
});

for (const enable of ['unknown-disable-ok', 'unknown-delete-ok']) {
  test(`unknown enable removes the row only after a confirmed ${enable === 'unknown-disable-ok' ? 'disable' : 'delete'}`, async t => {
    t.mock.method(console, 'error', () => {});
    const { ctx, calls, state } = fixture({ enable, cleanupFails: enable === 'unknown-disable-ok' });
    const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
    assert.equal(result.body.code, 'CREATE_SA_FAILED');
    assert.equal(state.row, null);
    assert.equal(state.enabled, false);
    assert.ok(calls.indexOf('remove-row') > calls.indexOf(enable === 'unknown-disable-ok' ? 'disable' : 'delete'));
    assert.ok(!result.body.needsOperatorReview);
  });
}

test('a registry insert that commits before throwing is compensated without enabling', async () => {
  const { ctx, calls, state } = fixture({ fail: 'insert-commit' });
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.body.code, 'CREATE_SA_FAILED');
  assert.equal(state.row, null);
  assert.equal(state.enabled, false);
  assert.ok(!calls.includes('enable'));
});

function provisioningHttp(t, { defaultMappers = [], optionalMappers = [], removalIgnored = false,
  inheritedRoles = ['offline_access', 'uma_authorization', `default-roles-${REALM}`] } = {}) {
  const state = { mappers: [], enabled: false, assigned: [], deleted: false };
  let defaults = [{ id: 'ws-scope', name: 'workspace-context' }, { id: 'custom-default', name: 'custom-ws' }];
  let optional = [{ id: 'custom-optional', name: 'custom-optional' }];
  const requests = keycloakHttp(t, r => {
    const base = `/realms/${REALM}`;
    const client = `${base}/clients/client-one`;
    if (r.path === `${base}/clients` && r.method === 'POST') {
      state.enabled = r.body.enabled;
      return new Response(null, { status: 201, headers: { location: `${client}` } });
    }
    if (r.path === `${base}/clients` && r.method === 'GET') return Response.json([]);
    if (r.path === `${client}/protocol-mappers/models`) {
      if (r.method === 'GET') return Response.json(state.mappers);
      state.mappers.push(r.body); return new Response(null, { status: 201 });
    }
    if (r.path === `${base}/roles`) return Response.json({ error: 'already exists' }, { status: 409 });
    if (r.path === `${base}/roles/${ROLE}`) return Response.json({ id: 'role-one', name: ROLE });
    if (r.path === `${client}/default-client-scopes`) return Response.json(defaults);
    if (r.path === `${client}/optional-client-scopes`) return Response.json(optional);
    if (r.path === `${client}/default-client-scopes/ws-scope` && r.method === 'DELETE') {
      if (!removalIgnored) defaults = defaults.filter(s => s.id !== 'ws-scope');
      return new Response(null, { status: 204 });
    }
    if (r.path === `${base}/client-scopes/custom-default/protocol-mappers/models`) return Response.json(defaultMappers);
    if (r.path === `${base}/client-scopes/custom-optional/protocol-mappers/models`) return Response.json(optionalMappers);
    if (r.path === `${base}/client-scopes/ws-scope/protocol-mappers/models`) {
      return Response.json([{ name: 'altered-context', protocolMapper: 'oidc-usermodel-attribute-mapper', config: { 'claim.name': 'workspace_id' } }]);
    }
    if (r.path === `${client}/service-account-user`) return Response.json({ id: 'user-one' });
    if (r.path === `${base}/users/user-one/role-mappings/realm`) {
      assert.equal(r.method, 'POST'); state.assigned = r.body; return new Response(null, { status: 204 });
    }
    if (r.path === `${base}/users/user-one/role-mappings/realm/composite`) {
      return Response.json([...state.assigned, ...inheritedRoles.map(name => ({ name }))]);
    }
    if (r.path === client && r.method === 'PUT') { state.enabled = r.body.enabled; return new Response(null, { status: 204 }); }
    if (r.path === client && r.method === 'DELETE') { state.deleted = true; state.enabled = false; return new Response(null, { status: 204 }); }
    assert.fail(`unexpected Keycloak request ${r.method} ${r.path}`);
  });
  return { state, requests };
}

test('real Keycloak helpers provision only the singular W source and allowlisted roles, tolerating role conflict', async t => {
  const http = provisioningHttp(t);
  const { ctx, state } = fixture();
  ctx.kcAdmin = kcAdmin;
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.statusCode, 201);
  assert.equal(http.state.enabled, true);
  assert.equal(state.row.workspace_id, W);
  assert.deepEqual(http.state.mappers.filter(m => m.config['claim.name']), [workspaceMapper()]);
  assert.deepEqual(http.state.assigned.map(r => r.name), [ROLE]);
  assert.equal(http.requests.at(-1).method, 'PUT');
  assert.deepEqual(http.requests.at(-1).body, { enabled: true });
});

for (const attachment of ['default', 'optional']) {
  for (const mapper of [
    { name: 'custom-ws', protocolMapper: 'oidc-usermodel-attribute-mapper', config: { 'claim.name': 'workspace_ids' } },
    { name: 'custom-actor', protocolMapper: 'oidc-hardcoded-claim-mapper', config: { 'claim.name': 'actor_type', 'claim.value': 'superadmin' } },
    { name: 'custom-role', protocolMapper: 'oidc-hardcoded-role-mapper', config: { role: 'platform_admin' } },
    { name: 'custom-rename', protocolMapper: 'oidc-role-name-mapper', config: {} },
  ]) {
    test(`creation rejects ${attachment} scope ${mapper.name} before enabling or recording`, async t => {
      const http = provisioningHttp(t, { [`${attachment}Mappers`]: [mapper] });
      const { ctx, state } = fixture(); ctx.kcAdmin = kcAdmin;
      const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
      assert.equal(result.body.code, 'CREATE_SA_FAILED');
      assert.equal(state.row, null);
      assert.equal(http.state.enabled, false);
      assert.equal(http.state.deleted, true);
      assert.ok(!http.requests.some(r => r.body?.enabled === true));
    });
  }
}

test('an altered workspace-context scope left attached fails creation', async t => {
  const http = provisioningHttp(t, { removalIgnored: true });
  const { ctx, state } = fixture(); ctx.kcAdmin = kcAdmin;
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.body.code, 'CREATE_SA_FAILED');
  assert.equal(state.row, null);
  assert.equal(http.state.deleted, true);
  assert.ok(!http.requests.some(r => r.body?.enabled === true));
});

test('signed singular SA workspace claims grant only its own workspace GET through control-plane authentication', async () => {
  const workspace = '44444444-4444-4444-4444-444444444444';
  const sibling = '55555555-5555-5555-5555-555555555555';
  const foreign = '66666666-6666-6666-6666-666666666666';
  const server = await startMetricsServer({ localHandlers: { getWorkspace: LOCAL_HANDLERS.getWorkspace },
    databasePool: { async query(sql, values) {
      if (sql.includes('FROM workspaces')) return { rows: [{ id: values[0], tenant_id: values[0] === foreign ? 'foreign-tenant' : TENANT }] };
      if (sql.includes('FROM tenants')) return { rows: [{ id: values[0], iam_realm: values[0] }] };
      if (sql.includes('scope_enforcement_denials')) return { rows: [] };
      if (sql.includes('FROM service_accounts')) return { rows: [{ status: 'active' }] };
      throw new Error('unexpected database operation');
    } },
  });
  const bearer = server.token({ sub: 'service-account-sa-worker', azp: 'sa-worker',
    realm_access: { roles: [ROLE] }, workspace_id: workspace });
  for (const [id, expected] of [[workspace, 200], [sibling, 403], [foreign, 403]]) {
    const response = await server.request(`/v1/workspaces/${id}`, { bearer });
    assert.equal(response.status, expected, response.body);
    if (expected === 403) assert.equal(JSON.parse(response.body).code, 'FORBIDDEN');
  }
});
