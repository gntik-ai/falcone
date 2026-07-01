// Role gate on Workspace Secret mutations (GitHub issue #798, bug/security, high).
//
// A read-only `tenant_viewer` and a non-admin `tenant_developer` (both resolve to the verified
// identity actorType `tenant_member`) could create/replace/delete Workspace Secrets in their own
// tenant — including the production workspace — because the secret write handlers only enforced the
// `ownedWorkspace` tenant/isolation check (cross-tenant → 404) and performed NO role check before
// writing to the OpenBao vault store. The fix adds the existing coarse `canManageTenant` tenant-admin
// gate (the same gate every other privileged CP write uses) to `secretSet` / `secretReplace` /
// `secretDelete` ONLY, placed AFTER the 404 so cross-tenant access stays 404 (no existence leak) and
// own-tenant-non-admin becomes 403 — persisting/deleting nothing.
//
// These tests drive the PUBLIC FN_HANDLERS surface of the kind control-plane directly with the repo's
// DI seams (ctx.store + ctx.vaultStore), mirroring tests/blackbox/console-workspace-secrets.test.mjs
// but with a SIMPLE recording fake vault store so we can assert the vault write methods are NEVER
// called when the gate denies. No DB, no real OpenBao — deterministic, isolated, self-contained.
//
//   uc-798-viewer-denied      tenant_viewer  → POST/PUT/DELETE secrets = 403, vault never written
//   uc-798-developer-denied   tenant_developer (also tenant_member) → 403, vault never written
//   uc-798-owner-allowed      tenant_owner  → create 201 / replace 200 / delete 204 (legit preserved)
//   uc-798-superadmin-allowed superadmin    → create 201 / replace 200 / delete 204 (legit preserved)
//   uc-798-reads-open         tenant_member → GET list / GET by-name still 200 (reads NOT gated)
//   uc-798-cross-tenant-404   tenant_member of another tenant → 404 WORKSPACE_NOT_FOUND (404 > 403)
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../deploy/kind/control-plane/fn-handlers.mjs';

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

// Fake Postgres store: the workspace always resolves to tenant 'acme' (a fixed owner). ownedWorkspace
// then denies any caller whose verified tenantId !== 'acme' (cross-tenant → null → 404), and admits
// callers of 'acme' plus platform callers (superadmin/internal, callerTenantId → null) — exactly the
// rows the role gate must then further filter by role.
const fakeStore = {
  async getWorkspace(_pool, id) { return { id, tenant_id: 'acme' }; },
  async listFnActions() { return []; }, // kind fn_actions row does not persist secret refs → refCount 0
};

// Verified identities (as produced by the CP JWT verifier). tenant_viewer/tenant_developer both map
// to actorType 'tenant_member'; tenant_owner/tenant_admin map to 'tenant_owner'.
const VIEWER = { actorType: 'tenant_member', tenantId: 'acme', sub: 'u1' };       // read-only
const DEVELOPER = { actorType: 'tenant_member', tenantId: 'acme', sub: 'u-dev' }; // non-admin developer
const OWNER = { actorType: 'tenant_owner', tenantId: 'acme', sub: 'u2' };
const SUPERADMIN = { actorType: 'superadmin', tenantId: null, sub: 'u3' };
const CROSS_TENANT_VIEWER = { actorType: 'tenant_member', tenantId: 'globex', sub: 'u4' };

function ctx({ identity, vault, params = {}, body = {} }) {
  return { pool: {}, store: fakeStore, vaultStore: vault, identity, params, body, callerContext: { correlationId: 'corr-798' } };
}

// 'prod-ws' stands for the tenant's PRODUCTION workspace — #798 requires no environment-dependent gap,
// so the non-owner denial must hold here exactly as on a dev workspace.
const PROD_WS = 'prod-ws';

// ---- non-owner tenant_member is DENIED on every write path, and nothing is persisted -------------
for (const [label, identity] of [['viewer', VIEWER], ['developer', DEVELOPER]]) {
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

// ---- reads stay open to a tenant_member: the role gate must NOT touch list/get -------------------
test('uc-798-reads-open: a tenant_member can still GET the secret list and GET a secret by name (200)', async () => {
  const listVault = recordingVault();
  const list = await FN_HANDLERS.secretList(ctx({ identity: VIEWER, vault: listVault, params: { workspaceId: PROD_WS } }));
  assert.equal(list.statusCode, 200, 'reads are not gated by role');

  const getVault = recordingVault();
  const get = await FN_HANDLERS.secretGet(ctx({ identity: VIEWER, vault: getVault, params: { workspaceId: PROD_WS, secretName: 'existing' } }));
  assert.equal(get.statusCode, 200, 'reads are not gated by role');
});

// ---- isolation preserved: 404 wins over 403 for a cross-tenant member (no own-vs-other leak) ------
test('uc-798-cross-tenant-404: a tenant_member of another tenant → 404 WORKSPACE_NOT_FOUND (404 before the 403) and no write', async () => {
  const vault = recordingVault({ exists: false });
  const res = await FN_HANDLERS.secretSet(ctx({ identity: CROSS_TENANT_VIEWER, vault, params: { workspaceId: PROD_WS }, body: { secretName: 'x', secretValue: 'v' } }));
  assert.equal(res.statusCode, 404, 'cross-tenant resolves to 404, never the new 403 (no existence/role leak)');
  assert.equal(res.body.code, 'WORKSPACE_NOT_FOUND');
  assert.deepEqual(vault.calls, [], 'nothing is written for a cross-tenant caller');
});
