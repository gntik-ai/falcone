import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';
import { resolveDimensionCounts } from '../../packages/provisioning-orchestrator/src/repositories/consumption-repository.mjs';
import { databaseDeleteFixture, mongoDeleteFixture } from '../helpers/database-delete-fixture.mjs';
import { setDatabase } from '../helpers/postgres-boundary.mjs';
import { request } from '../helpers/http-request.mjs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { queryAuditEvents } from '../../apps/control-plane/audit-store.mjs';
import { routes } from '../../apps/control-plane/routes.mjs';
import { register } from 'node:module';
register('../helpers/postgres-boundary-loader.mjs', import.meta.url);

test('#967: deleting each engine releases one measured quota unit', async () => {
  for (const [dimension, fixture] of [
    ['max_pg_databases', databaseDeleteFixture], ['max_mongo_databases', mongoDeleteFixture],
  ]) {
    const h = fixture();
    const usage = async () => (await resolveDimensionCounts(h.ctx.pool, 'tenant-a', [dimension])).get(dimension).currentUsage;
    assert.equal(await usage(), 1);
    assert.equal((await LOCAL_HANDLERS.deleteDatabase(h.ctx)).statusCode, 200);
    assert.equal(await usage(), 0);
  }
});

test('#967: authenticated HTTP provision/delete/re-provision preserves sibling resources and persists audit', async (t) => {
  const h = databaseDeleteFixture();
  h.pg.length = 0;
  h.physical.clear();
  h.roles.clear();
  setDatabase(h.ctx.pool);
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
  const claims = { sub: 'owner-a', tenant_id: 'tenant-a',
    iss: 'http://falcone-keycloak:8080/realms/tenant-a', exp: Math.floor(Date.now() / 1000) + 3600,
    realm_access: { roles: ['tenant_owner'] } };
  const unsigned = [{ alg: 'RS256', kid: 'fixture' }, claims].map((v) => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  const token = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
  const { server, loadRoutes } = await import('../../apps/control-plane/server.mjs');
  loadRoutes(routes);
  const send = (method, path) => request(server, { method, path, headers: {
    authorization: `Bearer ${token}`, 'x-correlation-id': 'database-delete-fixture',
  } });
  const siblings = async () => {
    const responses = [];
    for (const path of ['/v1/workspaces/ws-a', '/v1/workspaces/ws-a/service-accounts',
      '/v1/workspaces/ws-a/functions', '/v1/events/workspaces/ws-a/topics', '/v1/storage/workspaces/ws-a/usage']) {
      const result = await send('GET', path);
      assert.equal(result.status, 200, `expected sibling resource at ${path}`);
      const { snapshotAt, ...resource } = result.body;
      responses.push(resource);
    }
    return responses;
  };
  const before = await siblings();
  assert.equal((await send('POST', '/v1/workspaces/ws-a/database')).status, 201);
  const deleted = await send('DELETE', '/v1/workspaces/ws-a/databases/wsdb_tenant_a_app?force=true');
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal((await send('GET', '/v1/workspaces/ws-a/database')).body.code, 'DB_NOT_PROVISIONED');
  assert.deepEqual(await siblings(), before);
  assert.equal((await send('POST', '/v1/workspaces/ws-a/database')).status, 201);
  const audit = (await queryAuditEvents(h.ctx.pool, { tenantId: 'tenant-a', workspaceId: 'ws-a' }))
    .filter((row) => row.action_type === 'workspace.database.delete');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].outcome, 'succeeded');
  assert.equal(audit[0].new_state.workspaceId, 'ws-a');
  assert.doesNotMatch(JSON.stringify(audit), /password|dsn|postgresql:\/\//i);
});
