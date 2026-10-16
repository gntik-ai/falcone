import test from 'node:test';
import assert from 'node:assert/strict';
import { startDenialServer, TEN_A, WS_B } from '../blackbox/helpers/authorization-denial-server.mjs';

test('conflicting signed workspace claims cannot authorize a sibling workspace', async () => {
  const server = await startDenialServer({ workspaceRow: { id: WS_B, tenant_id: TEN_A } });
  const response = await server.request(`/v1/workspaces/${WS_B}`, {
    bearer: server.token({ realm_access: { roles: ['workspace_admin'] }, workspace_id: 'other', workspace_ids: [WS_B] }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(response.body), { code: 'FORBIDDEN', message: 'Invalid workspace binding' });
  const { rows } = await server.pool.query('SELECT * FROM scope_enforcement_denials');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].denial_type, 'WORKSPACE_SCOPE_MISMATCH');
  assert.equal(rows[0].workspace_id, null);
});

const invalidClaims = [
  ['array singular', { workspace_id: [WS_B] }],
  ['nested plural', { workspace_ids: [[WS_B]] }],
  ['additional workspace', { workspace_id: 'other', workspace_ids: ['other', WS_B] }],
];
for (const [name, claims] of invalidClaims) {
  test(`malformed signed binding is denied and audited once: ${name}`, async () => {
    const server = await startDenialServer({ workspaceRow: { id: WS_B, tenant_id: TEN_A } });
    const response = await server.request(`/v1/workspaces/${WS_B}`, {
      bearer: server.token({ realm_access: { roles: ['workspace_admin'] }, ...claims }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(JSON.parse(response.body), { code: 'FORBIDDEN', message: 'Invalid workspace binding' });
    const { rows } = await server.pool.query('SELECT * FROM scope_enforcement_denials');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].denial_type, 'WORKSPACE_SCOPE_MISMATCH');
    assert.equal(rows[0].workspace_id, null);
    assert.equal(rows[0].tenant_id, TEN_A);
    assert.equal(server.warnings.length, 0);
  });
}

for (const path of [
  `/v1/workspaces/${WS_B}/databases`,
  `/v1/storage/workspaces/${WS_B}/buckets`,
  `/v1/events/workspaces/${WS_B}/topics`,
]) {
  test(`conflicting binding is denied before dispatch: POST ${path}`, async () => {
    const server = await startDenialServer({ workspaceRow: { id: WS_B, tenant_id: TEN_A } });
    const response = await server.request(path, { method: 'POST', body: '{invalid json',
      bearer: server.token({ realm_access: { roles: ['workspace_admin'] }, workspace_id: 'other', workspace_ids: ['other', WS_B] }),
    });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body).message, 'Invalid workspace binding');
    const { rows } = await server.pool.query('SELECT * FROM scope_enforcement_denials');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].denial_type, 'WORKSPACE_SCOPE_MISMATCH');
    assert.equal(rows[0].workspace_id, null);
  });
}

for (const role of ['tenant_owner', 'superadmin', 'platform_admin']) {
  test(`invalid binding denies privileged role ${role}`, async () => {
    const server = await startDenialServer({ workspaceRow: { id: WS_B, tenant_id: TEN_A } });
    const platform = role !== 'tenant_owner';
    const response = await server.request(platform ? `/v1/workspaces/${WS_B}` : `/v1/tenants/${TEN_A}`, {
      bearer: server.token({ realm_access: { roles: [role] }, workspace_id: 'other', workspace_ids: ['other', WS_B],
        ...(platform ? { iss: 'http://fixture/realms/platform' } : {}) }),
    });
    assert.equal(response.status, 403);
    assert.equal(JSON.parse(response.body).message, 'Invalid workspace binding');
    const { rows } = await server.pool.query('SELECT * FROM scope_enforcement_denials');
    assert.equal(rows.length, platform ? 0 : 1);
    if (platform) {
      assert.equal(server.warnings.length, 1);
      assert.equal(JSON.parse(server.warnings[0]).event, 'authorization_denial_unattributed');
    } else {
      assert.equal(rows[0].denial_type, 'WORKSPACE_SCOPE_MISMATCH');
      assert.equal(rows[0].workspace_id, null);
    }
  });
}

for (const claims of [
  { workspace_ids: [WS_B] },
  { workspace_id: WS_B },
  { workspace_id: WS_B, workspace_ids: [WS_B] },
  { workspace_id: WS_B, workspace_ids: WS_B },
]) {
  test(`valid signed binding preserves workspace reads: ${JSON.stringify(claims)}`, async () => {
    const server = await startDenialServer({ workspaceRow: { id: WS_B, tenant_id: TEN_A } });
    const response = await server.request(`/v1/workspaces/${WS_B}`, {
      bearer: server.token({ realm_access: { roles: ['workspace_admin'] }, ...claims }),
    });
    assert.equal(response.status, 200);
    const { rows } = await server.pool.query('SELECT * FROM scope_enforcement_denials');
    assert.equal(rows.length, 0);
  });
}

test('ordinary route denials still record ROLE_INSUFFICIENT', async () => {
  const server = await startDenialServer();
  const response = await server.request('/v1/plans', {
    bearer: server.token({ realm_access: { roles: ['workspace_viewer'] } }),
  });
  assert.equal(response.status, 403);
  const { rows } = await server.pool.query('SELECT * FROM scope_enforcement_denials');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].denial_type, 'ROLE_INSUFFICIENT');
});

test('invalid binding preserves the Knative authorization envelope', async () => {
  const server = await startDenialServer();
  const response = await server.request('/v1/platform/runtime/knative', {
    bearer: server.token({ iss: 'http://fixture/realms/platform', tenant_id: TEN_A,
      realm_access: { roles: ['platform_admin'] }, workspace_id: ['other'] }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(JSON.parse(response.body), { code: 'FORBIDDEN',
    message: 'Caller lacks a platform observer role', correlationId: 'corr-fixture' });
  const { rows } = await server.pool.query('SELECT * FROM scope_enforcement_denials');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].denial_type, 'WORKSPACE_SCOPE_MISMATCH');
});
