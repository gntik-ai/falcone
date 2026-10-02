import test from 'node:test';
import assert from 'node:assert/strict';
import { kcAdmin, TENANT_AUDIENCE_MAPPER_NAME, tenantDataApiAudience } from '../../apps/control-plane/kc-admin.mjs';
import { parseBackfillArgs, runBackfill } from '../../scripts/backfill-tenant-realm-audience.mjs';

const audience = 'falcone-data-api';
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });

function fakeKeycloak() {
  const clients = [{ id: 'app-uuid', clientId: 'acme-app', attributes: { 'in-falcone.kind': 'tenant-app' } },
    { id: 'console-uuid', clientId: 'console' }];
  const mappers = [];
  const mappersByClient = new Map([['app-uuid', mappers]]);
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const method = init.method ?? 'GET';
    if (path.endsWith('/realms/master/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 300 }));
    }
    calls.push({ method, path });
    if (path.endsWith('/protocol-mappers/models')) {
      const clientUuid = path.match(/\/clients\/([^/]+)\/protocol-mappers\/models$/)[1];
      assert.ok(clients.some((client) => client.id === clientUuid
        && ['tenant-app', 'service-account'].includes(client.attributes?.['in-falcone.kind'])),
      'only managed data-API clients get a mapper');
      if (!mappersByClient.has(clientUuid)) mappersByClient.set(clientUuid, []);
      const clientMappers = mappersByClient.get(clientUuid);
      if (method === 'GET') return new Response(JSON.stringify(clientMappers));
      const mapper = JSON.parse(init.body);
      assert.ok(!clientMappers.some((existing) => existing.name === mapper.name), 'duplicate mapper POST');
      clientMappers.push(mapper);
      return new Response(null, { status: 201 });
    }
    if (path.endsWith('/clients')) {
      if (method === 'GET') return new Response(JSON.stringify(clients));
      const client = JSON.parse(init.body);
      clients.push({ ...client, id: 'app-uuid' });
      return new Response(null, { status: 201, headers: { location: `${url}/app-uuid` } });
    }
    throw new Error('unexpected fake Keycloak request');
  };
  return { clients, mappers, mappersByClient, calls };
}

test('audience mapper lists before POST, emits only the access-token audience, retry is a no-op', async () => {
  const kc = fakeKeycloak();
  assert.deepEqual(await kcAdmin.ensureTenantAudienceMapper('tenant-a', 'app-uuid', audience), { created: true });
  assert.deepEqual(await kcAdmin.ensureTenantAudienceMapper('tenant-a', 'app-uuid', audience), { created: false });
  assert.deepEqual(kc.calls.map((call) => call.method), ['GET', 'POST', 'GET']);
  assert.deepEqual(kc.mappers, [{
    name: TENANT_AUDIENCE_MAPPER_NAME, protocol: 'openid-connect', protocolMapper: 'oidc-audience-mapper',
    config: { 'included.custom.audience': audience, 'access.token.claim': 'true', 'id.token.claim': 'false' },
  }]);
});

test('existing conflicting or duplicate named mapper fails without a POST', async () => {
  const kc = fakeKeycloak();
  await kcAdmin.ensureTenantAudienceMapper('tenant-a', 'app-uuid', audience);
  const postCount = () => kc.calls.filter((call) => call.method === 'POST').length;
  kc.mappers[0].config['included.custom.audience'] = 'other';
  await assert.rejects(kcAdmin.ensureTenantAudienceMapper('tenant-a', 'app-uuid', audience), /configuration mismatch/);
  assert.equal(postCount(), 1);
  kc.mappers[0].config['included.custom.audience'] = audience;
  kc.mappers.push({ ...kc.mappers[0] });
  await assert.rejects(kcAdmin.ensureTenantAudienceMapper('tenant-a', 'app-uuid', audience), /configuration mismatch/);
  assert.equal(postCount(), 1);
});

test('tenant app creation and retry reuse the client, tenant identity and audience mappers', async () => {
  const kc = fakeKeycloak();
  kc.clients.length = 0;
  const input = { clientId: 'acme-app', name: 'Acme App', audience };
  await kcAdmin.ensureTenantAppAudience('tenant-a', input);
  await kcAdmin.ensureTenantAppAudience('tenant-a', input);
  assert.equal(kc.clients.length, 1);
  assert.equal(kc.mappers.length, 2);
  const identity = kc.mappers.find((mapper) => mapper.name === 'tenant_id');
  assert.equal(identity.protocolMapper, 'oidc-hardcoded-claim-mapper');
  assert.deepEqual(identity.config, {
    'claim.name': 'tenant_id', 'claim.value': 'tenant-a', 'jsonType.label': 'String',
    'access.token.claim': 'true', 'id.token.claim': 'true', 'userinfo.token.claim': 'true',
  });
  assert.equal(kc.mappers.filter((mapper) => mapper.name === TENANT_AUDIENCE_MAPPER_NAME).length, 1);
  assert.equal(kc.calls.filter((call) => call.method === 'POST').length, 3, 'one client and two distinct mappers');
});

test('existing tenant app gets its missing identity mapper once; conflicting identity fails before audience setup', async () => {
  const kc = fakeKeycloak();
  const input = { clientId: 'acme-app', audience };
  await kcAdmin.ensureTenantAppAudience('tenant-a', input);
  await kcAdmin.ensureTenantAppAudience('tenant-a', input);
  assert.equal(kc.calls.filter((call) => call.method === 'POST').length, 2);
  const identity = kc.mappers.find((mapper) => mapper.name === 'tenant_id');
  identity.config['claim.value'] = 'other-tenant';
  const before = kc.calls.length;
  await assert.rejects(kcAdmin.ensureTenantAppAudience('tenant-a', input), /identity mapper configuration mismatch/);
  assert.deepEqual(kc.calls.slice(before).map((call) => call.method), ['GET', 'GET']);
  identity.config['claim.value'] = 'tenant-a';
  kc.mappers.push({ ...identity });
  await assert.rejects(kcAdmin.ensureTenantAppAudience('tenant-a', input), /identity mapper configuration mismatch/);
  assert.equal(kc.calls.filter((call) => call.method === 'POST').length, 2);
});

test('dry run lists app and service-account mappers without mutations; apply then re-apply is a no-op', async () => {
  const kc = fakeKeycloak();
  kc.clients.push(
    { id: 'sa-uuid', clientId: 'sa-acme-worker', attributes: { 'in-falcone.kind': 'service-account' } },
    { id: 'disabled-sa-uuid', clientId: 'sa-acme-disabled', enabled: false, attributes: { 'in-falcone.kind': 'service-account' } },
  );
  const output = [];
  const opts = { kcAdmin, audience, loadTenantRealms: async () => ['tenant-a', 'tenant-a'], outStream: { write: (s) => output.push(s) } };
  const dry = await runBackfill(opts);
  assert.equal(dry.exitCode, 0);
  assert.deepEqual(dry.result.inspected, [{ realm: 'tenant-a', missing: [
    { id: 'app-uuid', clientId: 'acme-app' },
    { id: 'sa-uuid', clientId: 'sa-acme-worker' },
    { id: 'disabled-sa-uuid', clientId: 'sa-acme-disabled' },
  ] }]);
  assert.equal(kc.calls.filter((call) => call.method !== 'GET').length, 0);
  const apply = await runBackfill({ ...opts, argv: ['--apply'] });
  assert.equal(apply.result.counts.repaired, 3);
  const again = await runBackfill({ ...opts, argv: ['--apply'] });
  assert.equal(again.result.counts.needingWork, 0);
  assert.equal(again.result.counts.repaired, 0);
  assert.equal(kc.mappers.length, 1);
  for (const clientId of ['sa-uuid', 'disabled-sa-uuid']) {
    const mappers = kc.mappersByClient.get(clientId);
    assert.equal(mappers.length, 1);
    assert.equal(mappers[0].config['included.custom.audience'], audience);
    assert.equal(mappers[0].protocolMapper, 'oidc-audience-mapper');
  }
  assert.equal(kc.calls.filter((call) => call.method === 'POST').length, 3);
  assert.ok(!output.join('').includes('fake-token'));
});

test('reconciliation rejects conflicting service-account mappers before any repair', async () => {
  const kc = fakeKeycloak();
  kc.clients.push({ id: 'sa-uuid', clientId: 'sa-acme-worker', attributes: { 'in-falcone.kind': 'service-account' } });
  await kcAdmin.ensureTenantAudienceMapper('tenant-a', 'sa-uuid', audience);
  kc.mappersByClient.get('sa-uuid')[0].config['included.custom.audience'] = 'other';
  const before = kc.calls.length;
  const result = await runBackfill({
    argv: ['--apply'], kcAdmin, audience, loadTenantRealms: async () => ['tenant-a'], outStream: { write() {} },
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.result.failed, [{ realm: 'tenant-a', phase: 'inspect' }]);
  assert.equal(result.result.counts.repaired, 0);
  assert.ok(kc.calls.slice(before).every((call) => call.method === 'GET'));
  assert.equal(kc.mappers.length, 0, 'no partial tenant-app repair');
});

test('reconciliation reports missing client/provider failures and redacts raw errors', async () => {
  const output = [];
  const opts = { audience, loadTenantRealms: async () => ['tenant-a'], outStream: { write: (s) => output.push(s) } };
  const missing = await runBackfill({ ...opts, kcAdmin: { listClients: async () => [] } });
  assert.equal(missing.exitCode, 1);
  const saOnly = await runBackfill({ ...opts, kcAdmin: {
    listClients: async () => [{ id: 'sa-uuid', attributes: { 'in-falcone.kind': 'service-account' } }],
    listClientMappers: async () => assert.fail('missing tenant-app must still fail before inspection'),
  } });
  assert.equal(saOnly.exitCode, 1);
  const error = await runBackfill({ ...opts, kcAdmin: { listClients: async () => { throw new Error('OAuth-private-material'); } } });
  assert.equal(error.exitCode, 1);
  assert.deepEqual(error.result.failed, [{ realm: 'tenant-a', phase: 'inspect' }]);
  assert.ok(!output.join('').includes('OAuth-private-material'));
});

test('custom audience is emitted; empty configuration and unknown CLI options fail before mutation', async () => {
  const kc = fakeKeycloak();
  assert.equal(tenantDataApiAudience({}), audience);
  assert.deepEqual(parseBackfillArgs([]), { dryRun: true });
  assert.deepEqual(parseBackfillArgs(['--apply']), { dryRun: false });
  assert.throws(() => parseBackfillArgs(['--aply']), /unsupported/);
  await assert.rejects(kcAdmin.ensureTenantAudienceMapper('tenant-a', 'app-uuid', ''), /audience is required/);
  assert.equal(kc.calls.length, 0);
  await kcAdmin.ensureTenantAudienceMapper('tenant-a', 'app-uuid', 'custom-data-api');
  assert.equal(kc.mappers[0].config['included.custom.audience'], 'custom-data-api');
});
