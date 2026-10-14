import test from 'node:test';
import assert from 'node:assert/strict';
import { startMetricsServer, TENANT } from './helpers/control-plane-metrics-server.mjs';

test('HTTP inventory dispatch binds tenant scope and preserves an explicit platform filter', async () => {
  const queries = [];
  const databasePool = { async connect() { return this; }, release() {}, async query(sql, values) {
    if (!sql.includes('WITH inventory')) return { rows: [] };
    queries.push(values);
    return { rows: [{ name: 'key', domain: values[0], tenantId: values[1] }] };
  } };
  const server = await startMetricsServer({ databasePool });
  for (const [claims, query, expected] of [
    [{ realm_access: { roles: ['tenant_operator'] } }, 'domain=tenant', ['tenant', TENANT, 0, 50]],
    [{ iss: 'http://fixture/realms/platform', realm_access: { roles: ['platform_operator'] } },
      'domain=tenant&tenantId=22222222-2222-2222-2222-222222222222&offset=2&limit=10',
      ['tenant', '22222222-2222-2222-2222-222222222222', 2, 10]],
    [{ iss: 'http://fixture/realms/platform', realm_access: { roles: ['superadmin'] } }, 'domain=platform', ['platform', null, 0, 50]]
  ]) {
    const response = await server.request(`/v1/secrets/inventory?${query}`, { bearer: server.token(claims) });
    assert.equal(response.status, 200, response.body);
    assert.deepEqual(queries.at(-1), expected);
    const body = JSON.parse(response.body);
    assert.equal(body.secrets[0].tenantId, expected[1]);
    assert.deepEqual([body.offset, body.limit], expected.slice(2));
  }
});

test('HTTP inventory denies invalid requests and untrusted roles before querying', async () => {
  let queries = 0;
  const databasePool = { async connect() { return this; }, release() {}, async query(sql) {
    if (sql.includes('WITH inventory')) queries++;
    return { rows: [] };
  } };
  const server = await startMetricsServer({ databasePool });
  const platform = server.token({ iss: 'http://fixture/realms/platform', realm_access: { roles: ['superadmin'] } });
  const tenant = server.token({ realm_access: { roles: ['tenant_operator'] } });
  for (const [query, bearer, status, error] of [
    ['domain=platform', null, 401], ['', platform, 400, 'domain is required'],
    ['domain=invalid', platform, 400, 'invalid domain'], ['domain=platform&limit=0', platform, 400, 'invalid pagination'],
    ['domain=tenant&tenantId=22222222-2222-2222-2222-222222222222', tenant, 403, 'forbidden'],
    ['domain=platform', tenant, 403, 'forbidden'],
    ['domain=platform', server.token({ realm_access: { roles: ['platform_operator'] } }), 403, 'forbidden'],
    ['domain=tenant', server.token(), 403, 'forbidden']
  ]) {
    const response = await server.request(`/v1/secrets/inventory?${query}`, { bearer });
    assert.equal(response.status, status, response.body);
    if (error) assert.deepEqual(JSON.parse(response.body), { error });
  }
  assert.equal(queries, 0);
});
