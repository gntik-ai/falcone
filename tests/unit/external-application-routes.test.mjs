import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { routes } from '../../apps/control-plane/routes.mjs';
import { APPLICATION_HANDLERS } from '../../apps/control-plane/application-handlers.mjs';

const runtimeRouteMap = JSON.parse(readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));
const bHandlersSource = readFileSync(new URL('../../apps/control-plane/b-handlers.mjs', import.meta.url), 'utf8');

function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')
    .replace(/\/\\\*$/, '(?:/.*)?')
    .replace(/\\\*/g, '.*');
  return new RegExp('^' + rx + '/?$');
}

function compileRoutes(routeTable) {
  return routeTable
    .map((r) => ({ ...r, _rx: compilePath(r.path) }))
    .sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
      || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
}

function matchRoute(compiledRoutes, method, path) {
  for (const r of compiledRoutes) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

function validApplicationPayload(overrides = {}) {
  return {
    entityType: 'external_application',
    displayName: 'Acme Portal',
    slug: 'acme-portal',
    protocol: 'oidc',
    desiredState: 'active',
    metadata: { managedBy: 'unit-test' },
    redirectUris: ['https://portal.example.test/auth/callback'],
    login: {
      redirectUris: ['https://portal.example.test/auth/callback'],
      defaultRedirectUri: 'https://portal.example.test/auth/callback',
    },
    authenticationFlows: ['oidc_authorization_code_pkce'],
    scopes: [{ scopeName: 'openid' }, { scopeName: 'profile' }],
    federatedProviders: [],
    iamClient: { clientType: 'public' },
    ...overrides,
  };
}

function rowFromApplication(application, overrides = {}) {
  return {
    id: application.applicationId ?? 'app_existing',
    workspace_id: application.workspaceId ?? 'ws-acme',
    tenant_id: application.tenantId ?? 'ten-acme',
    slug: application.slug,
    protocol: application.protocol,
    state: application.state ?? application.desiredState ?? 'active',
    app_json: application,
    created_at: new Date('2026-06-30T00:00:00Z'),
    updated_at: new Date('2026-06-30T00:00:00Z'),
    created_by: 'owner-1',
    updated_by: 'owner-1',
    ...overrides,
  };
}

function fakeStore({ workspace = { id: 'ws-acme', tenant_id: 'ten-acme' }, applications = [] } = {}) {
  const calls = [];
  const rows = [...applications];
  return {
    calls,
    async getWorkspace(_pool, workspaceId) {
      calls.push(['getWorkspace', workspaceId]);
      return workspace;
    },
    async listExternalApplications(_pool, args) {
      calls.push(['listExternalApplications', args]);
      return { items: rows, total: rows.length };
    },
    async getExternalApplication(_pool, args) {
      calls.push(['getExternalApplication', args]);
      return rows.find((row) => row.id === args.applicationId || row.slug === args.applicationId) ?? null;
    },
    async upsertExternalApplication(_pool, args) {
      calls.push(['upsertExternalApplication', args]);
      const row = rowFromApplication(args.appJson, {
        id: args.id,
        workspace_id: args.workspaceId,
        tenant_id: args.tenantId,
        slug: args.slug,
        protocol: args.protocol,
        state: args.state,
        updated_at: new Date('2026-06-30T00:01:00Z'),
      });
      const index = rows.findIndex((item) => item.id === row.id);
      if (index >= 0) rows[index] = row;
      else rows.push(row);
      return row;
    },
  };
}

function ctx({ method = 'GET', params = { workspaceId: 'ws-acme' }, query = {}, body = {}, identity, store } = {}) {
  return {
    method,
    params,
    query,
    body,
    identity: identity ?? { actorType: 'tenant_owner', tenantId: 'ten-acme', sub: 'owner-1' },
    pool: {},
    store,
    callerContext: { correlationId: 'corr_781_unit' },
  };
}

function assertCollectionEnvelope(body, { pageSize }) {
  assert.deepEqual(Object.keys(body).sort(), ['items', 'page']);
  assert.equal(Array.isArray(body.items), true);
  assert.equal(body.total, undefined);
  assert.equal(Number.isInteger(body.page.size), true);
  assert.equal(body.page.size, pageSize);
  assert.equal(body.page.size >= 1 && body.page.size <= 200, true);
  if ('after' in body.page) assert.equal(typeof body.page.after, 'string');
  if ('nextCursor' in body.page) assert.equal(typeof body.page.nextCursor, 'string');
}

function assertSchemaCompatibleIamClient(iamClient, { clientType = 'public', clientId = 'acme-portal', realm = 'ten-acme' } = {}) {
  assert.equal(iamClient.realm, realm);
  assert.equal(iamClient.clientId, clientId);
  assert.equal(iamClient.clientType, clientType);
  assert.deepEqual(iamClient.defaultClientScopes, ['openid', 'profile']);
  assert.equal(Array.isArray(iamClient.redirectUris), true);
  assert.deepEqual(
    Object.keys(iamClient).sort(),
    ['clientId', 'clientType', 'defaultClientScopes', 'realm', 'redirectUris'],
  );
}

test('fix-781-00: application and federation routes resolve to local handlers, not NO_ROUTE', () => {
  const compiled = compileRoutes(routes);
  assert.match(bHandlersSource, /import \{ APPLICATION_HANDLERS \} from '\.\/application-handlers\.mjs';/);
  assert.match(bHandlersSource, /\.\.\.APPLICATION_HANDLERS/);
  const cases = [
    ['GET', '/v1/workspaces/ws-acme/applications', 'listExternalApplications'],
    ['POST', '/v1/workspaces/ws-acme/applications', 'createExternalApplication'],
    ['GET', '/v1/workspaces/ws-acme/applications/templates', 'listExternalApplicationStarterTemplates'],
    ['GET', '/v1/workspaces/ws-acme/applications/app-1', 'getExternalApplication'],
    ['PUT', '/v1/workspaces/ws-acme/applications/app-1', 'updateExternalApplication'],
    ['GET', '/v1/workspaces/ws-acme/applications/app-1/federation/providers', 'listExternalApplicationFederatedProviders'],
    ['POST', '/v1/workspaces/ws-acme/applications/app-1/federation/providers', 'createExternalApplicationFederatedProvider'],
    ['GET', '/v1/workspaces/ws-acme/applications/app-1/federation/providers/corp-oidc', 'getExternalApplicationFederatedProvider'],
    ['PUT', '/v1/workspaces/ws-acme/applications/app-1/federation/providers/corp-oidc', 'updateExternalApplicationFederatedProvider'],
  ];

  for (const [method, path, handler] of cases) {
    const hit = matchRoute(compiled, method, path);
    assert.ok(hit, `${method} ${path} must be registered`);
    assert.equal(hit.route.localHandler, handler);
    assert.equal(hit.route.auth, 'authenticated');
    assert.equal(typeof APPLICATION_HANDLERS[handler], 'function');

    const runtimeRoute = runtimeRouteMap.find((route) => route.method === method && route.localHandler === handler);
    assert.ok(runtimeRoute, `${handler} must be present in route-map.runtime.json loaded by the kind image`);
  }
});

test('fix-781-01: owned workspace application list returns an empty collection instead of 404 NO_ROUTE', async () => {
  const store = fakeStore();
  const res = await APPLICATION_HANDLERS.listExternalApplications(ctx({
    query: { limit: '100' },
    identity: { actorType: 'tenant_member', tenantId: 'ten-acme', sub: 'viewer-1' },
    store,
  }));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, []);
  assertCollectionEnvelope(res.body, { pageSize: 100 });
  assert.equal(res.body.code, undefined);
  assert.equal(store.calls.some(([name]) => name === 'listExternalApplications'), true);
});

test('fix-781-01b: starter templates collection uses the published page envelope', async () => {
  const store = fakeStore();
  const res = await APPLICATION_HANDLERS.listExternalApplicationStarterTemplates(ctx({ store }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.items.length > 0, true);
  assertCollectionEnvelope(res.body, { pageSize: res.body.items.length });
});

test('fix-781-02: valid tenant-owner create is accepted and persisted through the local handler', async () => {
  const store = fakeStore();
  const res = await APPLICATION_HANDLERS.createExternalApplication(ctx({
    method: 'POST',
    body: validApplicationPayload(),
    store,
  }));

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.status, 'accepted');
  assert.equal(res.body.entityType, 'external_application');
  assert.equal(res.body.workspaceId, 'ws-acme');
  assert.equal(res.body.tenantId, 'ten-acme');
  assert.notEqual(res.body.code, 'NO_ROUTE');

  const upserts = store.calls.filter(([name]) => name === 'upsertExternalApplication');
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0][1].slug, 'acme-portal');
  assertSchemaCompatibleIamClient(upserts[0][1].appJson.iamClient);

  const getRes = await APPLICATION_HANDLERS.getExternalApplication(ctx({
    params: { workspaceId: 'ws-acme', applicationId: upserts[0][1].id },
    store,
  }));
  assert.equal(getRes.statusCode, 200);
  assertSchemaCompatibleIamClient(getRes.body.iamClient);
});

test('fix-781-03: malformed create returns structured validation error and never writes', async () => {
  const store = fakeStore();
  const res = await APPLICATION_HANDLERS.createExternalApplication(ctx({
    method: 'POST',
    body: validApplicationPayload({ authenticationFlows: [] }),
    store,
  }));

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(res.body.validation.status, 'invalid');
  assert.equal(res.body.validation.checks.some((check) => check.code === 'missing_authentication_flow'), true);
  assert.notEqual(res.body.code, 'NO_ROUTE');
  assert.equal(store.calls.some(([name]) => name === 'upsertExternalApplication'), false);
});

test('fix-781-04: foreign workspace is hidden as 404 before the applications table is queried', async () => {
  const store = {
    calls: [],
    async getWorkspace(_pool, workspaceId) {
      this.calls.push(['getWorkspace', workspaceId]);
      return { id: 'ws-foreign', tenant_id: 'ten-other' };
    },
    async listExternalApplications() {
      throw new Error('application table must not be touched for a foreign workspace');
    },
  };

  const res = await APPLICATION_HANDLERS.listExternalApplications(ctx({
    identity: { actorType: 'tenant_owner', tenantId: 'ten-acme', sub: 'owner-1' },
    store,
  }));

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
  assert.deepEqual(store.calls, [['getWorkspace', 'ws-acme']]);
});

test('fix-781-05: tenantless non-platform caller cannot read guessed workspace applications', async () => {
  const application = {
    ...validApplicationPayload(),
    applicationId: 'app_foreign',
    tenantId: 'ten-foreign',
    workspaceId: 'ws-acme',
    state: 'active',
  };
  const store = fakeStore({
    workspace: { id: 'ws-acme', tenant_id: 'ten-foreign' },
    applications: [rowFromApplication(application)],
  });

  const res = await APPLICATION_HANDLERS.listExternalApplications(ctx({
    query: { limit: '100' },
    identity: { actorType: 'tenant_member', tenantId: null, sub: 'tenantless-1' },
    store,
  }));

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
  assert.equal(JSON.stringify(res.body).includes('ten-foreign'), false);
  assert.equal(JSON.stringify(res.body).includes('app_foreign'), false);
  assert.equal(store.calls.some(([name]) => name === 'getWorkspace'), false);
  assert.equal(store.calls.some(([name]) => name === 'listExternalApplications'), false);
});

test('fix-781-06: same-tenant non-admin can read but cannot mutate applications', async () => {
  const store = fakeStore();
  const res = await APPLICATION_HANDLERS.createExternalApplication(ctx({
    method: 'POST',
    identity: { actorType: 'tenant_member', tenantId: 'ten-acme', sub: 'member-1' },
    body: validApplicationPayload(),
    store,
  }));

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
  assert.equal(store.calls.some(([name]) => name === 'upsertExternalApplication'), false);
});

test('fix-781-07: provider create rejects payloads that would break later full application updates', async () => {
  const application = {
    ...validApplicationPayload(),
    applicationId: 'app_existing',
    tenantId: 'ten-acme',
    workspaceId: 'ws-acme',
    state: 'active',
    validation: { status: 'valid', checks: [] },
  };
  const store = fakeStore({ applications: [rowFromApplication(application)] });

  const res = await APPLICATION_HANDLERS.createExternalApplicationFederatedProvider(ctx({
    method: 'POST',
    params: { workspaceId: 'ws-acme', applicationId: 'app_existing' },
    body: {
      providerId: 'corp-oidc',
      alias: 'corp-oidc',
      displayName: 'Corporate OIDC',
      protocol: 'oidc',
      providerMode: 'manual_endpoints',
      enabled: true,
      authorizationUrl: 'https://idp.example.test/oauth/authorize',
      tokenUrl: 'https://idp.example.test/oauth/token',
    },
    store,
  }));

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.equal(res.body.validation.checks.some((check) => check.code === 'missing_oidc_discovery'), true);
  assert.equal(store.calls.some(([name]) => name === 'upsertExternalApplication'), false);
});

test('fix-781-08: valid provider create persists and remains compatible with full application update', async () => {
  const application = {
    ...validApplicationPayload(),
    applicationId: 'app_existing',
    tenantId: 'ten-acme',
    workspaceId: 'ws-acme',
    state: 'active',
    validation: { status: 'valid', checks: [] },
  };
  const store = fakeStore({ applications: [rowFromApplication(application)] });

  const res = await APPLICATION_HANDLERS.createExternalApplicationFederatedProvider(ctx({
    method: 'POST',
    params: { workspaceId: 'ws-acme', applicationId: 'app_existing' },
    body: {
      providerId: 'corp-oidc',
      alias: 'corp-oidc',
      displayName: 'Corporate OIDC',
      protocol: 'oidc',
      providerMode: 'manual_endpoints',
      enabled: true,
      issuer: 'https://idp.example.test',
      authorizationUrl: 'https://idp.example.test/oauth/authorize',
      tokenUrl: 'https://idp.example.test/oauth/token',
    },
    store,
  }));

  assert.equal(res.statusCode, 202);
  assert.equal(res.body.mutationScope, 'federated_provider');
  assert.equal(res.body.subresourceId, 'corp-oidc');
  const upsert = store.calls.find(([name]) => name === 'upsertExternalApplication');
  assert.ok(upsert);
  assert.equal(upsert[1].appJson.federatedProviders.length, 1);
  assert.equal(upsert[1].appJson.federatedProviders[0].providerId, 'corp-oidc');

  const providersList = await APPLICATION_HANDLERS.listExternalApplicationFederatedProviders(ctx({
    params: { workspaceId: 'ws-acme', applicationId: 'app_existing' },
    store,
  }));
  assert.equal(providersList.statusCode, 200);
  assertCollectionEnvelope(providersList.body, { pageSize: 1 });
  assert.equal(providersList.body.items.length, 1);

  const { federatedProviders: _providers, ...updateBody } = validApplicationPayload({
    displayName: 'Acme Portal Updated',
    desiredState: 'soft_deleted',
  });
  const update = await APPLICATION_HANDLERS.updateExternalApplication(ctx({
    method: 'PUT',
    params: { workspaceId: 'ws-acme', applicationId: 'app_existing' },
    body: updateBody,
    store,
  }));

  assert.equal(update.statusCode, 202);
  assert.equal(update.body.status, 'accepted');
  assert.equal(update.body.entityId, 'app_existing');
  const updateUpsert = store.calls.filter(([name]) => name === 'upsertExternalApplication').at(-1);
  assert.equal(updateUpsert[1].state, 'soft_deleted');
  assert.equal(updateUpsert[1].appJson.federatedProviders.length, 1);
});
