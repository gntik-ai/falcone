// Role gate on Workspace Secret mutations (GitHub issue #798, bug/security, high).
//
// #798 keeps the tenant-admin write gate after workspace visibility. #1141 adds verified
// workspace authority for reads and writes: unbound members get 404, bound members
// can read metadata but still get 403 on mutations. Test the exported handlers with
// recording vault/store boundaries, including production and cross-tenant denials.
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

// A SIMPLE recording fake vault store: every mutating method PUSHES to `calls` (so a denied write is
// provable by an empty `calls`) and returns a minimal FunctionWorkspaceSecret-ish meta. `exists` is
// configurable so create sees "absent" (→ 201) and replace/delete see "present" (→ 200). `getMeta`
// returns a meta so secretGet is 200; `list` returns one entry so secretList is 200.
function recordingVault({ exists = false } = {}) {
  const calls = [];
  const meta = (name) => ({ secretName: name, name, timestamps: { createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } });
  return {
    calls,
    validName: () => true,
    async exists() { return exists; },
    async set(tenantId, workspaceId, name, value, description) { calls.push(['set', name]); return meta(name); },
    async replace(tenantId, workspaceId, name, value, description) { calls.push(['replace', name]); return meta(name); },
    async delete(tenantId, workspaceId, name) { calls.push(['delete', name]); return true; },
    async list() { calls.push(['list']); return [meta('existing')]; },
    async getMeta(tenantId, workspaceId, name) { calls.push(['getMeta', name]); return meta(name); },
  };
}

// Persisted workspace ownership, independent of request or identity workspace claims.
const fakeStore = {
  async getWorkspace(_pool, id) { return { id, tenant_id: 'acme' }; },
  async listFnActions() { return []; }, // kind fn_actions row does not persist secret refs → refCount 0
};

// Verified identities (as produced by the CP JWT verifier). tenant_viewer/tenant_developer both map
// to actorType 'tenant_member'; tenant_owner/tenant_admin map to 'tenant_owner'.
const VIEWER = { actorType: 'tenant_member', tenantId: 'acme', roles: ['tenant_viewer'], workspaceIds: [], sub: 'u1' };       // read-only
const DEVELOPER = { actorType: 'tenant_member', tenantId: 'acme', roles: ['tenant_developer'], workspaceIds: [], sub: 'u-dev' }; // non-admin developer
const OWNER = { actorType: 'tenant_owner', tenantId: 'acme', roles: ['tenant_owner'], sub: 'u2' };
const SUPERADMIN = { actorType: 'superadmin', tenantId: null, sub: 'u3' };
const CROSS_TENANT_VIEWER = { actorType: 'tenant_member', tenantId: 'globex', roles: ['tenant_viewer'], workspaceIds: ['prod-ws'], sub: 'u4' };

function ctx({ identity, vault, params = {}, body = {} }) {
  return { pool: {}, store: fakeStore, vaultStore: vault, identity, params, body, callerContext: { correlationId: 'corr-798' } };
}

// 'prod-ws' stands for the tenant's PRODUCTION workspace — #798 requires no environment-dependent gap,
// so the non-owner denial must hold here exactly as on a dev workspace.
const PROD_WS = 'prod-ws';

// ---- non-owner tenant_member is DENIED on every write path, and nothing is persisted -------------
for (const [label, identity] of [['viewer', { ...VIEWER, workspaceIds: [PROD_WS] }], ['developer', { ...DEVELOPER, workspaceIds: [PROD_WS] }]]) {
  test(`uc-798-${label}-denied: secretSet (create) on production → 403 and the vault is never written`, async () => {
    const vault = recordingVault({ exists: false });
    const res = await FN_HANDLERS.secretSet(ctx({ identity, vault, params: { workspaceId: PROD_WS }, body: { secretName: 'db_password', secretValue: 'pwned' } }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
    assert.deepEqual(vault.calls, [], 'no vault method (incl. set) may be called when the write is denied');
  });

  test(`uc-798-${label}-denied: secretReplace on production → 403 and the vault is never written`, async () => {
    const vault = recordingVault({ exists: true }); // the secret exists — only the role gate may stop the replace
    const res = await FN_HANDLERS.secretReplace(ctx({ identity, vault, params: { workspaceId: PROD_WS, secretName: 'db_password' }, body: { secretValue: 'x' } }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
    assert.deepEqual(vault.calls, [], 'no vault method (incl. replace) may be called when the write is denied');
  });

  test(`uc-798-${label}-denied: secretDelete on production → 403 and the vault is never written`, async () => {
    const vault = recordingVault({ exists: true });
    const res = await FN_HANDLERS.secretDelete(ctx({ identity, vault, params: { workspaceId: PROD_WS, secretName: 'db_password' } }));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'FORBIDDEN');
    assert.deepEqual(vault.calls, [], 'no vault method (incl. delete) may be called when the write is denied');
  });
}

// ---- an admin tenant role (and superadmin) STILL succeeds — legitimate behavior is preserved ------
for (const [label, identity] of [['owner', OWNER], ['superadmin', SUPERADMIN]]) {
  test(`uc-798-${label}-allowed: secretSet 201, secretReplace 200, secretDelete 204 (vault written)`, async () => {
    const createVault = recordingVault({ exists: false });
    const create = await FN_HANDLERS.secretSet(ctx({ identity, vault: createVault, params: { workspaceId: PROD_WS }, body: { secretName: 'api_key', secretValue: 'v' } }));
    assert.equal(create.statusCode, 201);
    assert.ok(createVault.calls.some(([m]) => m === 'set'), 'an authorized create calls vault.set');

    const replaceVault = recordingVault({ exists: true });
    const replace = await FN_HANDLERS.secretReplace(ctx({ identity, vault: replaceVault, params: { workspaceId: PROD_WS, secretName: 'api_key' }, body: { secretValue: 'v2' } }));
    assert.equal(replace.statusCode, 200);
    assert.ok(replaceVault.calls.some(([m]) => m === 'replace'), 'an authorized replace calls vault.replace');

    const deleteVault = recordingVault({ exists: true });
    const del = await FN_HANDLERS.secretDelete(ctx({ identity, vault: deleteVault, params: { workspaceId: PROD_WS, secretName: 'api_key' } }));
    assert.equal(del.statusCode, 204);
    assert.equal(del.body, null);
    assert.ok(deleteVault.calls.some(([m]) => m === 'delete'), 'an authorized delete calls vault.delete');
  });
}

// ---- bound members can read metadata without tenant-admin mutation authority -------------------
test('uc-798-reads-open: a bound tenant_viewer can still GET the secret list and GET a secret by name (200)', async () => {
  const listVault = recordingVault();
  const list = await FN_HANDLERS.secretList(ctx({ identity: { ...VIEWER, workspaceIds: [PROD_WS] }, vault: listVault, params: { workspaceId: PROD_WS } }));
  assert.equal(list.statusCode, 200, 'bound readers need no admin role');

  const getVault = recordingVault();
  const get = await FN_HANDLERS.secretGet(ctx({ identity: { ...VIEWER, workspaceIds: [PROD_WS] }, vault: getVault, params: { workspaceId: PROD_WS, secretName: 'existing' } }));
  assert.equal(get.statusCode, 200, 'bound readers need no admin role');
});

// ---- isolation preserved: 404 wins over 403 for a cross-tenant member (no own-vs-other leak) ------
test('uc-798-cross-tenant-404: a tenant_member of another tenant → 404 WORKSPACE_NOT_FOUND (404 before the 403) and no write', async () => {
  const vault = recordingVault({ exists: false });
  const res = await FN_HANDLERS.secretSet(ctx({ identity: CROSS_TENANT_VIEWER, vault, params: { workspaceId: PROD_WS }, body: { secretName: 'x', secretValue: 'v' } }));
  assert.equal(res.statusCode, 404, 'cross-tenant resolves to 404, never the new 403 (no existence/role leak)');
  assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
  assert.deepEqual(vault.calls, [], 'nothing is written for a cross-tenant caller');
});

for (const identity of [VIEWER, DEVELOPER, { ...VIEWER, workspaceIds: ['dev-ws'] },
  { actorType: 'tenant_owner', tenantId: 'acme' }]) {
  test(`unbound/wrong-workspace secret access is concealed: ${JSON.stringify(identity)}`, async () => {
    for (const handler of ['secretSet', 'secretReplace', 'secretDelete', 'secretList', 'secretGet']) {
      const vault = recordingVault({ exists: true });
      const res = await FN_HANDLERS[handler](ctx({ identity, vault,
        params: { workspaceId: PROD_WS, secretName: 'existing' },
        body: { secretName: 'existing', secretValue: 'v', workspaceId: PROD_WS } }));
      assert.deepEqual(res, { statusCode: 404, body: { code: 'WORKSPACE_NOT_FOUND', message: 'workspace prod-ws not found' } }, handler);
      assert.deepEqual(vault.calls, [], 'denial must precede vault reads and writes');
    }
  });
}
