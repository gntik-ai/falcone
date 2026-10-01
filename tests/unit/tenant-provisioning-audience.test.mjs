import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin, KeycloakAdminError, TENANT_AUDIENCE_MAPPER_NAME } from '../../apps/control-plane/kc-admin.mjs';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

test('control-plane saga adds one audience mapper on step retry and before the tenant record', async () => {
  const originalFetch = globalThis.fetch;
  const mappers = [];
  let posts = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 300 }));
    }
    assert.match(url, /\/clients\/app-one\/protocol-mappers\/models$/);
    if (init.method === 'GET') return new Response(JSON.stringify(mappers));
    assert.equal(init.method, 'POST');
    posts += 1;
    mappers.push(JSON.parse(init.body));
    return new Response(null, { status: 201 });
  };
  const steps = [];
  const ctx = {
    pool: {}, identity: { sub: 'superadmin' }, body: { displayName: 'Acme', slug: 'acme' },
    kcAdmin: {
      realmExists: async () => false, createRealm: async () => {}, createRealmRole: async () => {},
      createPublicAppClient: async () => 'app-one', addHardcodedClaimMapper: async () => {},
      ensureTenantAudienceMapper: kcAdmin.ensureTenantAudienceMapper.bind(kcAdmin),
    },
    store: {
      slugTaken: async () => false,
      insertTenant: async (_pool, input) => {
        assert.equal(mappers.length, 1);
        return { id: input.id, iam_realm: input.iamRealm, slug: input.slug };
      },
    },
    startSaga: async () => ({
      runId: 'test-saga',
      step: async (name, fn) => {
        steps.push(name);
        const result = await fn();
        if (name === 'ensureTenantAudienceMapper') await fn();
        return result;
      },
      complete: async () => {}, fail: async () => assert.fail('saga unexpectedly failed'),
    }),
  };
  try {
    const result = await LOCAL_HANDLERS.createTenant(ctx);
    assert.equal(result.statusCode, 201);
    assert.equal(posts, 1);
    assert.equal(mappers[0].protocolMapper, 'oidc-audience-mapper');
    assert.equal(mappers[0].config['included.custom.audience'], 'falcone-data-api');
    assert.ok(steps.indexOf('ensureTenantAudienceMapper') > steps.indexOf('createTenantAppClient'));
    assert.ok(steps.indexOf('ensureTenantAudienceMapper') < steps.indexOf('insertTenant'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function serviceAccountContext(kc, query) {
  return {
    identity: { sub: 'owner-one', actorType: 'tenant_owner', tenantId: 'tenant-one' },
    params: { workspaceId: 'workspace-one' }, body: { displayName: 'Worker' },
    store: {
      getWorkspace: async () => ({ id: 'workspace-one', slug: 'dev', tenant_id: 'tenant-one' }),
      getTenant: async () => ({ iam_realm: 'tenant-one' }),
    },
    pool: { query }, kcAdmin: kc,
  };
}

for (const existing of [false, true]) {
  test(`service-account creation ensures one audience before the record (${existing ? 'existing' : 'missing'} mapper)`, async () => {
    const originalFetch = globalThis.fetch;
    const mapper = {
      name: TENANT_AUDIENCE_MAPPER_NAME, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
      config: { 'included.custom.audience': 'falcone-data-api', 'access.token.claim': 'true', 'id.token.claim': 'false' },
    };
    const mappers = existing ? [mapper] : [];
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      if (url.endsWith('/realms/master/protocol/openid-connect/token')) {
        return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 300 }));
      }
      calls.push(init.method);
      if (url.endsWith('/realms/tenant-one/clients')) {
        assert.equal(init.method, 'POST');
        const client = JSON.parse(init.body);
        assert.equal(client.attributes['in-falcone.kind'], 'service-account');
        assert.equal(client.clientId, 'sa-dev-worker');
        assert.equal(client.serviceAccountsEnabled, true);
        return new Response(null, { status: 201, headers: { location: `${url}/sa-one` } });
      }
      assert.ok(url.endsWith('/realms/tenant-one/clients/sa-one/protocol-mappers/models'));
      if (init.method === 'GET') return new Response(JSON.stringify(mappers));
      assert.equal(init.method, 'POST');
      assert.equal(mappers.length, 0, 'no duplicate mapper POST');
      mappers.push(JSON.parse(init.body));
      return new Response(null, { status: 201 });
    };
    const kc = {
      findClient: async () => null,
      createConfidentialClient: kcAdmin.createConfidentialClient.bind(kcAdmin),
      ensureTenantAudienceMapper: async (realm, uuid) => {
        await kcAdmin.ensureTenantAudienceMapper(realm, uuid);
        await kcAdmin.ensureTenantAudienceMapper(realm, uuid); // Retry must remain read-only.
      },
    };
    const ctx = serviceAccountContext(kc, async (sql, values) => {
      assert.match(sql, /INSERT INTO service_accounts/);
      assert.deepEqual(mappers, [mapper], 'audience must exist before recording the account');
      assert.equal(values[3], 'tenant-one');
      assert.equal(values[5], 'sa-one');
      calls.push('record');
      return { rows: [{ id: values[0], status: 'active', kc_client_id: values[4] }] };
    });
    try {
      const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
      assert.equal(result.statusCode, 201);
      assert.deepEqual(calls, existing ? ['POST', 'GET', 'GET', 'record'] : ['POST', 'GET', 'POST', 'GET', 'record']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('service-account mapper failure prevents a successful account record and redacts the error', async () => {
  const calls = [];
  const ctx = serviceAccountContext({
    findClient: async () => null,
    createConfidentialClient: async () => { calls.push('client'); return 'sa-one'; },
    ensureTenantAudienceMapper: async (realm, uuid) => {
      assert.equal(realm, 'tenant-one');
      assert.equal(uuid, 'sa-one');
      calls.push('mapper');
      throw new KeycloakAdminError({ status: 500, statusCode: 502, body: { error: 'OAuth-private-material' } });
    },
  }, async () => assert.fail('account must not be recorded without the audience'));
  const result = await LOCAL_HANDLERS.createServiceAccount(ctx);
  assert.equal(result.statusCode, 502);
  assert.equal(result.body.code, 'CREATE_SA_FAILED');
  assert.ok(!JSON.stringify(result).includes('OAuth-private-material'));
  assert.deepEqual(calls, ['client', 'mapper']);
});
