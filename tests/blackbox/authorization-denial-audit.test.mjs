import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDenialServer, TEN_A, TEN_B, WS_B } from './helpers/authorization-denial-server.mjs';
import { main as queryDenials } from '../../packages/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs';

function assertDenialHeaders(response) {
  assert.deepEqual(Object.fromEntries(response.headers), {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(response.body)),
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-correlation-id,idempotency-key',
    'access-control-max-age': '600'
  });
}

async function auditRows(server) {
  const result = await queryDenials({
    from: new Date(Date.now() - 60000).toISOString(), to: new Date(Date.now() + 60000).toISOString(),
    callerContext: { tenantId: TEN_A, actor: { type: 'tenant_owner' } }
  }, { db: server.pool });
  assert.equal(result.statusCode, 200);
  return result.body.denials;
}

test('a tenant probing a role gate receives the original 403 and one audit denial', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  const response = await server.request('/v1/plans', { correlationId: 'corr-gate' });
  assert.equal(response.status, 403);
  assert.equal(response.body, '{"code":"FORBIDDEN","message":"requires superadmin"}');
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(response.body)));
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assertDenialHeaders(response);
  const rows = await auditRows(server);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].denial_type, 'ROLE_INSUFFICIENT');
  assert.equal(rows[0].required_role, 'superadmin');
  assert.equal(rows[0].actor_type, 'service_account');
  assert.equal(rows[0].correlation_id, 'corr-gate');
});

test('thrown module denials preserve their response and are recorded once', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  const response = await server.request(`/v1/tenants/${TEN_A}/backup/scope`, { correlationId: 'corr-module' });
  assert.equal(response.status, 403);
  assert.equal(response.body, '{"code":"FORBIDDEN","message":"FORBIDDEN"}');
  assertDenialHeaders(response);
  const rows = await auditRows(server);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].required_role, 'authenticated');
  assert.equal(rows[0].request_path, '/v1/tenants/{tenantId}/backup/scope');
});

test('returned module denials preserve their response and are recorded once', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  const response = await server.request('/v1/admin/config/format-versions', {
    bearer: server.token({ realm_access: { roles: ['platform_admin'] } })
  });
  assert.equal(response.status, 403);
  assert.equal(response.body, '{"error":"Forbidden: insufficient role or missing scope platform:admin:config:export"}');
  assertDenialHeaders(response);
  assert.equal((await auditRows(server)).length, 1);
});

test('the eleven-request issue matrix preserves responses and records every denial once', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  const matrix = [
    ['/v1/tenants', 'requires superadmin', 'superadmin', '/v1/tenants'],
    ['/v1/plans', 'requires superadmin', 'superadmin', '/v1/plans'],
    ['/v1/admin/backup/scope', 'requires superadmin', 'superadmin', '/v1/admin/backup/scope'],
    ...[TEN_A, TEN_B].map((tenant) => [`/v1/tenants/${tenant}/quota/overrides`,
      'requires superadmin', 'superadmin', '/v1/tenants/{tenantId}/quota/overrides']),
    ...[TEN_A, TEN_B].map((tenant) => [`/v1/tenants/${tenant}/backup/scope`,
      'FORBIDDEN', 'authenticated', '/v1/tenants/{tenantId}/backup/scope']),
    [`/v1/tenants/${TEN_B}`, 'cannot read another tenant', 'authenticated', '/v1/tenants/{tenantId}'],
    [`/v1/tenants/${TEN_B}/users`, 'requires superadmin or tenant owner/admin of this tenant',
      'authenticated', '/v1/tenants/{tenantId}/users'],
    [`/v1/workspaces/${WS_B}`, 'cannot read another tenant workspace', 'authenticated', '/v1/workspaces/{workspaceId}'],
    [`/v1/workspaces/${WS_B}/service-accounts`, 'requires superadmin or tenant owner/admin',
      'authenticated', '/v1/workspaces/{workspaceId}/service-accounts']
  ];
  for (const [i, [path, message, auth, template]] of matrix.entries()) {
    const response = await server.request(path, { correlationId: `corr-matrix-${i}` });
    assert.equal(response.status, 403, path);
    assert.equal(response.body, JSON.stringify({ code: 'FORBIDDEN', message }), path);
    assert.equal(response.headers.get('content-length'), String(Buffer.byteLength(response.body)));
    assertDenialHeaders(response);
    const rows = await auditRows(server);
    assert.equal(rows.length, i + 1, path);
    const row = rows.find((denial) => denial.correlation_id === `corr-matrix-${i}`);
    assert.equal(row.tenant_id, TEN_A);
    assert.equal(row.actor_type, 'service_account');
    assert.equal(row.denial_type, 'ROLE_INSUFFICIENT');
    assert.equal(row.required_role, auth);
    assert.equal(row.request_path, template);
    assert.equal(row.workspace_id, null);
  }
});

test('non-403 dispatch results produce no denial', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  for (const [path, options, status] of [
    [`/v1/tenants/${TEN_A}`, {}, 200],
    ['/v1/plans', { bearer: null }, 401],
    ['/no-route', {}, 404],
    [`/v1/tenants/${TEN_A}`, { body: '{' }, 400],
    ['/v1/tenants', { bearer: server.token({ realm_access: { roles: ['superadmin'] } }) }, 500]
  ]) {
    assert.equal((await server.request(path, options)).status, status);
  }
  assert.equal((await auditRows(server)).length, 0);
});

test('tenant-owner gates and user tokens retain their attribution', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  const response = await server.request('/v1/tenant/plan/effective-entitlements', {
    bearer: server.token({ azp: 'app-client' })
  });
  assert.equal(response.body, '{"code":"FORBIDDEN","message":"requires tenant_owner"}');
  const [row] = await auditRows(server);
  assert.equal(row.required_role, 'tenant_owner');
  assert.equal(row.actor_type, 'user');
});

test('an insert failure warns and leaves the original denial response intact', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (line) => warnings.push(line));
  const server = await startDenialServer({ insert: async () => { throw Error('database unavailable'); } });
  t.after(server.close);
  const response = await server.request('/v1/plans');
  assert.equal(response.status, 403);
  assert.equal(response.body, '{"code":"FORBIDDEN","message":"requires superadmin"}');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /scope denial write skipped/);
  assert.equal((await auditRows(server)).length, 0);
});

test('a pending insert cannot delay the denial response', async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const server = await startDenialServer({ insert: () => pending });
  t.after(server.close);
  let response;
  const request = server.request('/v1/plans').then((value) => { response = value; });
  await new Promise(setImmediate);
  try {
    assert.equal(response?.status, 403, 'response must complete while INSERT remains pending');
  } finally {
    release();
    await request;
  }
});

test('the audit query accepts role denials and rejects unknown types', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  await server.request('/v1/plans');
  const params = {
    from: new Date(Date.now() - 60000).toISOString(), to: new Date(Date.now() + 60000).toISOString(),
    callerContext: { tenantId: TEN_A, actor: { type: 'tenant_owner' } }
  };
  const result = await queryDenials({ ...params, denial_type: 'ROLE_INSUFFICIENT' }, { db: server.pool });
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.denials.length, 1);
  const invalid = await queryDenials({ ...params, denial_type: 'MADE_UP' }, { db: server.pool });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error, 'INVALID_DENIAL_TYPE');
});

test('verified service-account claim variants and generated correlation ids reach the audit', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  for (const claims of [{ azp: 'sa-alpha' }, { azp: undefined, client_id: 'sa-alpha' }, { azp: undefined, clientId: 'sa-alpha' }]) {
    await server.request('/v1/plans', { bearer: server.token(claims), correlationId: null });
  }
  const rows = await auditRows(server);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((row) => row.correlation_id)).size, 3);
  for (const row of rows) {
    assert.equal(row.actor_type, 'service_account');
    assert.match(row.correlation_id, /^[0-9a-f-]{36}$/);
  }
});

test('a platform actor without a tenant emits one structured log and no row', async (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (line) => warnings.push(line));
  const server = await startDenialServer();
  t.after(server.close);
  const response = await server.request('/v1/plans', {
    bearer: server.token({ iss: 'http://fixture/realms/platform', azp: 'app-client' })
  });
  assert.equal(response.status, 403);
  assert.equal((await auditRows(server)).length, 0);
  assert.equal(warnings.length, 1);
  assert.deepEqual(JSON.parse(warnings[0]), {
    event: 'authorization_denial_unattributed', tenant_id: null, actor_id: 'actor-alpha', actor_type: 'user',
    http_method: 'GET', request_path: '/v1/plans', required_role: 'superadmin', correlation_id: 'corr-fixture'
  });
});

test('the knative_status denial keeps its special error envelope', async (t) => {
  const server = await startDenialServer();
  t.after(server.close);
  const response = await server.request('/v1/platform/runtime/knative', { correlationId: 'corr-knative' });
  assert.equal(response.status, 403);
  assert.equal(response.body, '{"code":"FORBIDDEN","message":"Caller lacks a platform observer role","correlationId":"corr-knative"}');
  assertDenialHeaders(response);
  assert.equal((await auditRows(server)).length, 1);
});
