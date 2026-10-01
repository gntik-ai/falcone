import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin } from '../../apps/control-plane/kc-admin.mjs';
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
