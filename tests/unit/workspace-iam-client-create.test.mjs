import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin } from '../../apps/control-plane/kc-admin.mjs';

const handler = async (ctx) => {
  const { createWorkspaceIamClient } = await import('../../apps/control-plane/workspace-iam-client-handlers.mjs');
  return createWorkspaceIamClient(ctx);
};
function context(body = {}) {
  return {
    params: { workspaceId: 'ws-one' },
    identity: { sub: 'owner-one', actorType: 'tenant_owner', tenantId: 'tenant-one' },
    body: { clientId: 'browser-app', clientType: 'public', redirectUris: ['https://app.example/callback'], scopes: ['openid', 'profile'], permissions: [], ...body },
    store: {
      async getWorkspace() { return { id: 'ws-one', tenant_id: 'tenant-one' }; },
      async getTenant() { return { id: 'tenant-one', iam_realm: 'realm-one' }; },
    },
    kcAdmin,
  };
}
async function keycloakBoundary(run, options = {}) {
  const original = globalThis.fetch;
  let client = options.existing ?? null;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) return Response.json({ access_token: 'fake-boundary-token', expires_in: 300 });
    assert.ok(url.includes('/admin/realms/realm-one/'), 'realm must come from the tenant');
    calls.push({ url, method, body: init.body && JSON.parse(init.body) });
    if (url.endsWith('/client-scopes')) return Response.json([{ name: 'profile' }, { name: 'email' }, { name: 'custom-api' }, ...(options.realmDefaults ?? []).map((name) => ({ name }))]);
    if (url.endsWith('/default-default-client-scopes')) {
      if (options.defaultScopesError) return Response.json({ secret: 'upstream-secret-canary' }, { status: 503 });
      return Response.json((options.realmDefaults ?? []).map((name) => ({ name })));
    }
    if (url.includes('/clients?')) return Response.json(client ? [options.briefList ? { id: client.id, clientId: client.clientId } : client] : []);
    if (method === 'GET' && url.endsWith('/clients/kc-client-one')) return Response.json(client);
    if (url.endsWith('/clients/kc-client-one/protocol-mappers/models')) {
      if (method === 'GET') return Response.json(client.protocolMappers ?? []);
      if (options.mapperError) return Response.json({ secret: 'upstream-secret-canary' }, { status: 503 });
      client.protocolMappers = [...(client.protocolMappers ?? []), JSON.parse(init.body)];
      if (options.mapperMismatch) client.protocolMappers[0].config['claim.value'] = 'tenant-other';
      return new Response(null, { status: 201 });
    }
    if (method === 'POST' && url.endsWith('/clients')) {
      if (options.race) {
        client = { ...JSON.parse(init.body), id: 'kc-client-one' };
        client.protocolMappers = [{ name: 'tenant_id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
          config: { 'claim.name': 'tenant_id', 'claim.value': 'realm-one', 'jsonType.label': 'String',
            'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true' } }];
        if (options.race === 'foreign') client.attributes['in-falcone.workspace-id'] = 'ws-other';
        return Response.json({ error: 'already exists' }, { status: 409 });
      }
      if (options.createError) return Response.json({ secret: 'upstream-secret-canary' }, { status: options.createError });
      client = { ...JSON.parse(init.body), id: 'kc-client-one' };
      if (options.mismatch) client.directAccessGrantsEnabled = true;
      if (options.dropDefaults) client.defaultClientScopes = client.defaultClientScopes.filter((scope) => scope !== 'basic');
      return new Response(null, { status: 201, headers: { location: `${url}/kc-client-one` } });
    }
    if (url.endsWith('/client-secret')) return Response.json({ value: 'one-time-secret-canary' });
    if (method === 'DELETE') {
      if (options.deleteError) return Response.json({ secret: 'upstream-secret-canary' }, { status: 503 });
      client = null; return new Response(null, { status: 204 });
    }
    assert.fail(`Unexpected boundary request: ${method}`);
  };
  try { await run({ calls, client: () => client }); }
  finally { globalThis.fetch = original; }
}

test('public wizard payload creates a verified PKCE client in the workspace tenant realm', async () => {
  await keycloakBoundary(async ({ client, calls }) => {
    const result = await handler(context());
    assert.equal(result.statusCode, 201);
    assert.deepEqual(result.body, { iamClientId: 'kc-client-one', clientId: 'browser-app', clientType: 'public', realm: 'realm-one', workspaceId: 'ws-one' });
    assert.deepEqual(client(), {
      id: 'kc-client-one', clientId: 'browser-app', name: 'browser-app', enabled: true, protocol: 'openid-connect',
      publicClient: true, standardFlowEnabled: true, serviceAccountsEnabled: false, directAccessGrantsEnabled: false,
      redirectUris: ['https://app.example/callback'], webOrigins: [], defaultClientScopes: ['profile'], optionalClientScopes: [],
      attributes: { 'in-falcone.kind': 'workspace-iam-client', 'in-falcone.workspace-id': 'ws-one', 'pkce.code.challenge.method': 'S256' },
      protocolMappers: [{ name: 'tenant_id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
        config: { 'claim.name': 'tenant_id', 'claim.value': 'realm-one', 'jsonType.label': 'String',
          'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true' } }],
    });
    assert.equal(calls.some((c) => c.url.endsWith('/client-secret')), false);
  });
});

test('unchecked wizard scopes retain realm identity defaults on creation and equivalent replay', async () => {
  await keycloakBoundary(async ({ client, calls }) => {
    const result = await handler(context({ scopes: [] }));
    assert.equal(result.statusCode, 201);
    assert.deepEqual(client().defaultClientScopes, [
      'basic', 'email', 'plan-context', 'profile', 'roles', 'tenant-context', 'web-origins', 'workspace-context', 'workspace-roles',
    ]);
    const replay = await handler(context({ scopes: ['openid', 'profile', 'email'] }));
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.body.iamClientId, result.body.iamClientId);
    assert.equal(Object.hasOwn(replay.body, 'clientSecret'), false);
    assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/clients')).length, 1);
    assert.equal(calls.filter((c) => c.url.endsWith('/client-scopes')).length, 2, 'validate offered scopes once per request');
  }, { realmDefaults: ['profile', 'email', 'roles', 'web-origins', 'basic', 'tenant-context', 'workspace-context', 'plan-context', 'workspace-roles'] });
});

test('all workspace client types carry a server-owned tenant identity mapper', async () => {
  for (const clientType of ['public', 'confidential', 'service_account']) {
    await keycloakBoundary(async ({ client }) => {
      const result = await handler(context({ clientType, redirectUris: clientType === 'service_account' ? [] : ['https://app.example/callback'],
        protocolMappers: [{ name: 'caller-mapper', config: { 'claim.name': 'tenant_id', 'claim.value': 'tenant-other' } }] }));
      assert.equal(result.statusCode, 201);
      assert.deepEqual(client().protocolMappers, [{
        name: 'tenant_id', protocol: 'openid-connect', protocolMapper: 'oidc-hardcoded-claim-mapper',
        config: { 'claim.name': 'tenant_id', 'claim.value': 'realm-one', 'jsonType.label': 'String',
          'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true' },
      }]);
    });
  }
});

test('requested scopes add to realm defaults for every client type without weakening verification', async () => {
  for (const clientType of ['public', 'confidential', 'service_account']) {
    await keycloakBoundary(async ({ client }) => {
      const ctx = context({ clientType, redirectUris: clientType === 'service_account' ? [] : ['https://app.example/callback'], scopes: ['custom-api', 'openid', 'custom-api'] });
      const result = await handler(ctx);
      assert.equal(result.statusCode, 201);
      assert.deepEqual(client().defaultClientScopes, ['basic', 'custom-api', 'roles', 'tenant-context', 'workspace-context']);
      assert.equal((await handler(ctx)).statusCode, 200);
      client().defaultClientScopes = client().defaultClientScopes.filter((scope) => scope !== 'basic');
      assert.equal((await handler(ctx)).statusCode, 409, 'replay must retain default identity mappings');
    }, { realmDefaults: ['roles', 'basic', 'tenant-context', 'workspace-context'] });
  }
});

test('unavailable defaults and missing realized identity mappings fail closed with compensation', async () => {
  for (const options of [{ defaultScopesError: true }, { dropDefaults: true }, { mapperError: true }, { mapperMismatch: true }]) {
    await keycloakBoundary(async ({ client, calls }) => {
      const result = await handler(context({ scopes: [] }));
      assert.equal(result.statusCode, 502);
      assert.equal(result.body.code, 'IAM_CREATE_CLIENT_FAILED');
      assert.equal(client(), null);
      assert.equal(calls.filter((c) => c.method === 'DELETE').length, options.defaultScopesError ? 0 : 1);
      assert.equal(result.iamClientAudit.compensation, options.defaultScopesError ? 'none' : 'deleted');
      assert.equal(calls.some((c) => c.url.endsWith('/client-secret')), false);
      assert.doesNotMatch(JSON.stringify(result), /upstream-secret-canary|\/admin\/realms|clientSecret/);
    }, { realmDefaults: ['basic', 'tenant-context'], ...options });
  }
});

test('unauthorized and cross-tenant callers never reach Keycloak; missing workspace and realm fail closed', async () => {
  await keycloakBoundary(async ({ calls }) => {
    for (const identity of [undefined, { actorType: 'tenant_member', tenantId: 'tenant-one' }, { actorType: 'workspace_admin', tenantId: 'tenant-one' }, { actorType: 'internal' }, { actorType: 'tenant_owner', tenantId: 'tenant-other' }]) {
      assert.equal((await handler({ ...context(), identity })).statusCode, 403);
    }
    const missing = context(); missing.store.getWorkspace = async () => null;
    assert.deepEqual((await handler(missing)).body.code, 'WORKSPACE_NOT_FOUND');
    const realmMissing = context(); realmMissing.store.getTenant = async () => ({});
    const result = await handler(realmMissing);
    assert.equal(result.statusCode, 409); assert.equal(result.body.code, 'NO_REALM');
    assert.equal(calls.length, 0);
  });
});

test('invalid identifiers, client types, URI targets, scopes and permissions are rejected before creation', async () => {
  const invalids = [
    { clientId: undefined }, { clientId: 'has spaces' }, { clientId: '../escape' }, { clientType: 'unknown' },
    { redirectUris: [] }, { redirectUris: 'https://app.example' },
    ...['https://*.example/cb', 'https://app.example/%2a', 'https://user:pass@app.example/cb', 'https://@app.example/cb', 'https://app.example/cb#', 'http://app.example/cb', 'javascript:alert(1)', 'http://localhost.evil/cb', 'https://app.example/\\evil', ' https://app.example/cb', 'https:app.example/cb'].map((uri) => ({ redirectUris: [uri] })),
    ...['*', 'https://user@app.example', 'https://app.example/#frag', 'http://app.example', 'https://app.example/path'].map((uri) => ({ webOrigins: [uri] })),
    { scopes: ['unknown'] }, { scopes: 'profile' }, { realm: 'attacker' }, { realmId: 'attacker' }, { tenantId: 'attacker' },
  ];
  await keycloakBoundary(async ({ calls }) => {
    for (const body of invalids) {
      const result = await handler(context(body));
      assert.equal(result.statusCode, 400, JSON.stringify(body));
      assert.equal(result.body.code, 'VALIDATION_ERROR');
    }
    const unsupported = await handler(context({ permissions: ['manage_iam'] }));
    assert.equal(unsupported.statusCode, 400); assert.equal(unsupported.body.code, 'UNSUPPORTED_FIELD');
    assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/clients')).length, 0);
  });
});

test('confidential authorization-code clients return a secret once with no-store', async () => {
  await keycloakBoundary(async ({ client }) => {
    const result = await handler(context({ clientType: 'confidential', scopes: ['openid', 'custom-api'] }));
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.clientSecret, 'one-time-secret-canary');
    assert.equal(result.headers['Cache-Control'], 'no-store');
    assert.equal(client().publicClient, false);
    assert.equal(client().standardFlowEnabled, true);
    assert.equal(client().serviceAccountsEnabled, false);
    assert.equal(client().directAccessGrantsEnabled, false);
    assert.deepEqual(client().defaultClientScopes, ['custom-api']);
    assert.equal(client().attributes['in-falcone.workspace-id'], 'ws-one');
  });
});

test('service accounts enable only client credentials and have no redirects', async () => {
  await keycloakBoundary(async ({ client }) => {
    const result = await handler(context({ clientType: 'service_account', redirectUris: [], scopes: ['email'] }));
    assert.equal(result.statusCode, 201);
    assert.equal(result.body.clientSecret, 'one-time-secret-canary');
    assert.equal(client().standardFlowEnabled, false);
    assert.equal(client().serviceAccountsEnabled, true);
    assert.equal(client().publicClient, false);
    assert.equal(client().directAccessGrantsEnabled, false);
    assert.deepEqual(client().redirectUris, []);
    assert.deepEqual(client().webOrigins, []);
    assert.deepEqual(client().defaultClientScopes, ['email']);
  });
});

test('public clients accept offered custom scopes and HTTPS or HTTP loopback targets', async () => {
  await keycloakBoundary(async ({ client }) => {
    const ctx = context({ scopes: ['openid', 'custom-api'], redirectUris: ['http://127.0.0.1:3030/cb', 'http://[::1]:3030/cb', 'http://localhost:3030/cb'], webOrigins: ['https://app.example'] });
    ctx.identity = { actorType: 'superadmin', sub: 'platform-actor' };
    assert.equal((await handler(ctx)).statusCode, 201);
    assert.deepEqual(client().defaultClientScopes, ['custom-api']);
  });
});

test('equivalent replay and concurrent duplicates return the same UUID with no replayed secret or second create', async () => {
  for (const clientType of ['public', 'confidential', 'service_account']) {
    await keycloakBoundary(async ({ calls }) => {
      const make = () => context({ clientType, redirectUris: clientType === 'service_account' ? [] : ['https://app.example/callback'], scopes: ['profile', 'openid', 'profile'] });
      const first = await handler(make());
      assert.equal(first.statusCode, 201);
      const replay = await handler({ ...make(), body: { ...make().body, scopes: ['profile'] } });
      assert.equal(replay.statusCode, 200);
      assert.equal(replay.body.iamClientId, first.body.iamClientId);
      assert.equal(Object.hasOwn(replay.body, 'clientSecret'), false);
      assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/clients')).length, 1);
      assert.equal(calls.filter((c) => c.url.endsWith('/client-secret')).length, clientType === 'public' ? 0 : 1);
    });
  }
  await keycloakBoundary(async ({ calls }) => {
    const results = await Promise.all(Array.from({ length: 8 }, () => handler(context())));
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
    assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/clients')).length, 1);
  });
});

test('verification and replay read the full client when the Keycloak search response is brief', async () => {
  await keycloakBoundary(async () => {
    const first = await handler(context());
    assert.equal(first.statusCode, 201);
    assert.equal((await handler(context())).statusCode, 200);
  }, { briefList: true });
});

test('Keycloak uniqueness races replay only an equivalent owned client and never delete the winner', async () => {
  for (const race of ['equivalent', 'foreign']) {
    await keycloakBoundary(async ({ calls }) => {
      const result = await handler(context({ clientType: 'confidential' }));
      assert.equal(result.statusCode, race === 'equivalent' ? 200 : 409);
      if (race === 'foreign') assert.equal(result.body.code, 'IAM_CLIENT_EXISTS');
      assert.equal(Object.hasOwn(result.body, 'clientSecret'), false);
      assert.equal(calls.some((c) => c.method === 'DELETE' || c.url.endsWith('/client-secret')), false);
    }, { race });
  }
});

test('Keycloak errors are normalized and redacted, and verification mismatch compensates only this attempt', async (t) => {
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) => t.mock.method(console, method, () => {}));
  for (const status of [401, 404, 500, 503]) {
    await keycloakBoundary(async ({ calls }) => {
      const result = await handler(context());
      assert.equal(result.statusCode, 502);
      assert.equal(result.body.code, 'IAM_CREATE_CLIENT_FAILED');
      assert.doesNotMatch(JSON.stringify(result), /upstream-secret-canary|\/admin\/realms|clientSecret/);
      assert.equal(calls.some((c) => c.method === 'DELETE'), false);
    }, { createError: status });
  }
  await keycloakBoundary(async ({ calls, client }) => {
    const result = await handler(context());
    assert.equal(result.statusCode, 502);
    assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
    assert.equal(client(), null);
    assert.equal(calls.some((c) => c.url.endsWith('/client-secret')), false);
  }, { mismatch: true });
  const ctx = context();
  ctx.kcAdmin = { async listClientScopes() { throw new Error('network problem including secret=upstream-secret-canary'); } };
  const result = await handler(ctx);
  assert.equal(result.statusCode, 502);
  assert.doesNotMatch(JSON.stringify(result), /upstream-secret-canary/);
  assert.doesNotMatch(JSON.stringify(logs.flatMap((log) => log.mock.calls.map((call) => call.arguments))), /upstream-secret-canary|\/admin\/realms|clientSecret/);
});

test('audit descriptors record redacted requested config, actor, target tenant and realized UUID on success and compensation failure', async (t) => {
  const logs = ['log', 'info', 'warn', 'error', 'debug'].map((method) => t.mock.method(console, method, () => {}));
  const { auditEventForRoute } = await import('../../apps/control-plane/audit-writer.mjs');
  const route = { method: 'POST', path: '/v1/workspaces/{workspaceId}/iam/clients', localHandler: 'createWorkspaceIamClient' };
  for (const mismatch of [false, true]) {
    await keycloakBoundary(async () => {
      const ctx = context({ clientType: 'confidential', clientSecret: 'request-secret-canary', redirectUris: ['https://app.example/callback?token=query-secret-canary'] });
      ctx.identity = { sub: 'platform-actor', actorType: 'superadmin' };
      const result = await handler(ctx);
      const audit = auditEventForRoute(route, ctx, result);
      assert.ok(audit);
      assert.equal(audit.actorId, 'platform-actor');
      assert.equal(audit.tenantId, 'tenant-one');
      assert.equal(audit.workspaceId, 'ws-one');
      assert.equal(audit.outcome, mismatch ? 'error' : 'succeeded');
      assert.equal(audit.newState.iamClient.iamClientId, 'kc-client-one');
      assert.equal(audit.newState.iamClient.requested.clientType, 'confidential');
      assert.equal(audit.newState.iamClient.compensation, mismatch ? 'failed' : 'none');
      assert.doesNotMatch(JSON.stringify(audit), /one-time-secret-canary|request-secret-canary|query-secret-canary|upstream-secret-canary/);
    }, { mismatch, deleteError: mismatch });
  }
  const ctx = context(); ctx.identity.tenantId = 'tenant-other';
  const denied = await handler(ctx);
  const audit = auditEventForRoute(route, ctx, denied);
  assert.equal(audit.outcome, 'denied');
  assert.equal(audit.tenantId, 'tenant-one');
  assert.doesNotMatch(JSON.stringify(logs.flatMap((log) => log.mock.calls.map((call) => call.arguments))), /one-time-secret-canary|request-secret-canary|query-secret-canary|upstream-secret-canary|\/admin\/realms/);
});

test('a client with a foreign workspace, missing ownership tag or divergent realized config cannot be replayed', async () => {
  for (const mutate of [
    (c) => { c.attributes['in-falcone.workspace-id'] = 'ws-foreign'; },
    (c) => { delete c.attributes['in-falcone.kind']; },
    (c) => { c.redirectUris = ['https://foreign.example/callback']; },
    (c) => { c.webOrigins = ['https://foreign.example']; },
    (c) => { c.defaultClientScopes = ['email']; },
    (c) => { c.optionalClientScopes = ['offline_access']; },
    (c) => { c.protocolMappers = []; },
    (c) => { c.protocolMappers[0].config['claim.value'] = 'tenant-other'; },
    (c) => { c.protocolMappers[0].config['access.token.claim'] = 'false'; },
    (c) => { c.publicClient = false; },
    (c) => { c.standardFlowEnabled = false; },
    (c) => { c.serviceAccountsEnabled = true; },
    (c) => { c.directAccessGrantsEnabled = true; },
    (c) => { c.implicitFlowEnabled = true; },
    (c) => { c.attributes['pkce.code.challenge.method'] = 'plain'; },
  ]) {
    await keycloakBoundary(async ({ client, calls }) => {
      assert.equal((await handler(context())).statusCode, 201);
      mutate(client());
      const result = await handler(context());
      assert.equal(result.statusCode, 409);
      assert.equal(result.body.code, 'IAM_CLIENT_EXISTS');
      assert.equal(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/clients')).length, 1);
      assert.equal(calls.some((c) => c.method === 'DELETE'), false);
    });
  }
});
