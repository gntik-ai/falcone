import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
import { resolve } from 'node:path';
import { setDatabase } from '../helpers/postgres-boundary.mjs';
import { idempotencyDatabase } from '../helpers/idempotency-database.mjs';
import { request } from '../helpers/http-request.mjs';
register('../helpers/postgres-boundary-loader.mjs', import.meta.url);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' };
const claims = { sub: 'fixture-user', tenant_id: 'fixture-tenant', iss: 'http://falcone-keycloak:8080/realms/in-falcone-platform', exp: Math.floor(Date.now() / 1000) + 3600, realm_access: { roles: ['superadmin'] } };
const unsigned = [ { alg: 'RS256', kid: 'fixture' }, claims ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const token = `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
const headers = { authorization: `Bearer ${token}`, 'idempotency-key': 'same-key-123' };

test('control-plane HTTP: local and action dispatch replay with verified identity and preserve retry semantics', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
  const replay = idempotencyDatabase();
  let denials = 0, plans = 0, failNext = false;
  setDatabase({ async query(sql, values = []) {
    if (sql.includes('http_idempotency_records')) return replay.query(sql, values);
    if (sql.includes('INSERT INTO scope_enforcement_denials')) {
      return { rows: [{ id: `denial-${++denials}` }], rowCount: 1 };
    }
    if (sql.includes('INSERT INTO plans')) {
      if (failNext) { failNext = false; throw new Error('fixture database outage'); }
      return { rows: [{ id: `plan-${++plans}`, slug: values[0], display_name: values[1], status: 'active' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  } });
  const { server, loadRoutes } = await import('../../apps/control-plane/server.mjs');
  assert.equal(server.listening, false, 'importing the dispatcher does not bypass startup gates');
  loadRoutes([{ method: 'POST', path: '/v1/plans', module: resolve('packages/provisioning-orchestrator/src/actions/plan-create.mjs'), export: 'main', invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeBodyIntoParams: true }]);
  const input = { path: '/v1/internal/scope-enforcement/denials', headers, body: '{"tenant_id":"fixture-tenant","actor_id":"fixture-user","correlation_id":"fixture-correlation"}' };
  const first = await request(server, input);
  const second = await request(server, input);
  assert.equal(first.status, 202);
  assert.equal(first.headers['x-idempotency-replayed'], undefined);
  assert.deepEqual(second.body, first.body);
  assert.equal(second.headers['x-idempotency-replayed'], 'true');
  assert.match(second.headers['access-control-expose-headers'], /X-Idempotency-Replayed/);
  assert.equal(denials, 1);
  assert.equal((await request(server, { ...input, body: '{"changed":true}' })).status, 422);
  const planInput = { path: '/v1/plans', headers: { ...headers, 'idempotency-key': 'plan-key-123' }, body: '{"slug":"fixture-plan","displayName":"Fixture Plan"}' };
  const plan = await request(server, planInput);
  assert.equal(plan.status, 201);
  assert.deepEqual((await request(server, planInput)).body, plan.body);
  assert.equal(plans, 1);
  failNext = true;
  const retryInput = { ...planInput, headers: { ...headers, 'idempotency-key': 'retry-key-123' } };
  assert.equal((await request(server, retryInput)).status, 500);
  assert.equal((await request(server, retryInput)).status, 201);
  const { 'idempotency-key': _key, ...unkeyedHeaders } = headers;
  assert.equal((await request(server, { ...input, headers: unkeyedHeaders })).status, 202);
  assert.equal((await request(server, { ...input, headers: unkeyedHeaders })).status, 202);
  assert.equal(denials, 3);
  assert.equal(plans, 2);
});
