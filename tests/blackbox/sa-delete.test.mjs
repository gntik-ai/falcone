/**
 * Black-box tests for add-service-account-delete (GitHub issue #687, enhancement, P16).
 *
 * Defect/gap: there was no way to fully delete a service account. The API offered
 * create / get / list / credential-issuance / -rotations / -revocations, but no DELETE.
 * `revokeCredential` only DISABLED the Keycloak client + set PG status='revoked' — the PG row
 * AND the Keycloak client persisted forever, so revoked/unused service accounts accumulated in
 * both stores. `DELETE /v1/workspaces/{ws}/service-accounts/{saId}` was NO_ROUTE (404).
 *
 * Enhancement: a new `deleteServiceAccount` handler (wired at DELETE on the SA-by-id route) removes
 * BOTH the Keycloak confidential client (idempotent on 404) AND the PG row, so the SA disappears
 * from list results. It reuses saForCredential() → resolveWorkspaceForManage(), so it inherits the
 * sibling handlers' isolation/edge semantics: cross-tenant caller → 403, missing/foreign SA → 404,
 * and a 2nd DELETE (or GET) on the removed SA is idempotently 404. Works for active OR revoked SAs.
 *
 * This suite drives the PUBLIC handler surface deterministically (no DB, no Keycloak) via the
 * ctx.store / ctx.kcAdmin DI seams, mirroring sa-credential-revocation-invalidate-tokens.test.mjs:
 *   bbx-687-01  authorized delete removes the KC client + the PG row → 200 { deleted:true } (Scenario)
 *   bbx-687-02  a revoked SA can also be deleted (active OR revoked)
 *   bbx-687-03  cross-tenant caller → 403, and NEITHER store is touched (isolation)
 *   bbx-687-04  unknown/foreign SA → 404 SA_NOT_FOUND, and NEITHER store is touched
 *   bbx-687-05  idempotent re-delete: once the row is gone, getServiceAccount→null ⇒ 404 (no deletes)
 *   bbx-687-06  a non-404 Keycloak failure → 502 and the PG row is NOT removed (no orphaned client)
 *   bbx-687-07  the response carries exactly { serviceAccountId, deleted, deletedAt } (contract)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../apps/control-plane/b-handlers.mjs';

// ---- handler harness: inject store + kcAdmin via ctx (parity with the revoke suite) ----------
function handlerCtx(overrides = {}) {
  const calls = { deleteClient: [], deleteSA: [] };
  const sa = {
    id: 'sa-uuid-1', workspace_id: 'ws-1', tenant_id: 'ten-1', iam_realm: 'ten-1',
    kc_client_id: 'sa-acme-repro', kc_client_uuid: 'kc-uuid-1', status: 'active',
  };
  const store = {
    async getWorkspace() { return { id: 'ws-1', tenant_id: 'ten-1', slug: 'acme' }; },
    async getTenant() { return { id: 'ten-1', iam_realm: 'ten-1' }; },
    async getServiceAccount() { return sa; },
    async deleteServiceAccount(_p, id) { calls.deleteSA.push(id); },
    ...overrides.store,
  };
  const kcAdmin = {
    base: 'http://kc',
    async deleteClient(realm, uuid) { calls.deleteClient.push([realm, uuid]); },
    ...overrides.kcAdmin,
  };
  return {
    calls, sa,
    ctx: {
      pool: {}, store, kcAdmin,
      identity: overrides.identity ?? { sub: 'owner-1', actorType: 'tenant_owner', tenantId: 'ten-1' },
      params: { workspaceId: 'ws-1', serviceAccountId: 'sa-uuid-1' },
      body: {},
    },
  };
}

test('bbx-687-01: authorized delete removes the KC client + the PG row → 200 { deleted:true } (Scenario)', async () => {
  const h = handlerCtx();
  const res = await LOCAL_HANDLERS.deleteServiceAccount(h.ctx);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.equal(res.body.serviceAccountId, 'sa-uuid-1');
  assert.deepEqual(h.calls.deleteClient, [['ten-1', 'kc-uuid-1']], 'deletes the Keycloak client by (realm, uuid)');
  assert.deepEqual(h.calls.deleteSA, ['sa-uuid-1'], 'deletes the PG row by id');
});

test('bbx-687-02: a REVOKED service account can also be deleted (active OR revoked)', async () => {
  const h = handlerCtx({ store: { async getServiceAccount() { return { id: 'sa-uuid-1', workspace_id: 'ws-1', tenant_id: 'ten-1', iam_realm: 'ten-1', kc_client_id: 'sa-acme-repro', kc_client_uuid: 'kc-uuid-1', status: 'revoked' }; } } });
  const res = await LOCAL_HANDLERS.deleteServiceAccount(h.ctx);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.deleted, true);
  assert.deepEqual(h.calls.deleteClient, [['ten-1', 'kc-uuid-1']]);
  assert.deepEqual(h.calls.deleteSA, ['sa-uuid-1']);
});

test('bbx-687-03: cross-tenant caller → 403 and NEITHER store is touched (isolation)', async () => {
  const h = handlerCtx({ identity: { sub: 'owner-2', actorType: 'tenant_owner', tenantId: 'ten-2' } });
  const res = await LOCAL_HANDLERS.deleteServiceAccount(h.ctx);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
  assert.deepEqual(h.calls.deleteClient, [], 'no Keycloak deletion on a forbidden caller');
  assert.deepEqual(h.calls.deleteSA, [], 'no PG deletion on a forbidden caller');
});

test('bbx-687-04: unknown/foreign SA → 404 SA_NOT_FOUND and NEITHER store is touched', async () => {
  // foreign SA: belongs to a different workspace than the path's workspace.
  const h = handlerCtx({ store: { async getServiceAccount() { return { id: 'sa-uuid-1', workspace_id: 'ws-OTHER', tenant_id: 'ten-1', iam_realm: 'ten-1', kc_client_uuid: 'kc-uuid-1' }; } } });
  const res = await LOCAL_HANDLERS.deleteServiceAccount(h.ctx);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'SA_NOT_FOUND');
  assert.deepEqual(h.calls.deleteClient, []);
  assert.deepEqual(h.calls.deleteSA, []);
});

test('bbx-687-05: idempotent re-delete — a removed SA reads as null ⇒ 404 (no further deletes)', async () => {
  // After the first delete the row is gone, so getServiceAccount returns null on the 2nd call.
  const h = handlerCtx({ store: { async getServiceAccount() { return null; } } });
  const res = await LOCAL_HANDLERS.deleteServiceAccount(h.ctx);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'SA_NOT_FOUND');
  assert.deepEqual(h.calls.deleteClient, []);
  assert.deepEqual(h.calls.deleteSA, []);
});

test('bbx-687-06: a non-404 Keycloak failure → 502 and the PG row is NOT removed (no orphaned client)', async () => {
  const h = handlerCtx({ kcAdmin: { base: 'http://kc', async deleteClient() { const e = new Error('keycloak down'); e.statusCode = 502; throw e; } } });
  const res = await LOCAL_HANDLERS.deleteServiceAccount(h.ctx);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, 'DELETE_SA_FAILED');
  assert.deepEqual(h.calls.deleteSA, [], 'the PG row must survive a failed Keycloak delete so the caller can retry');
});

test('bbx-687-07: response carries exactly { serviceAccountId, deleted, deletedAt } (contract)', async () => {
  const res = await LOCAL_HANDLERS.deleteServiceAccount(handlerCtx().ctx);
  assert.deepEqual(Object.keys(res.body).sort(), ['deleted', 'deletedAt', 'serviceAccountId']);
  assert.equal(typeof res.body.deletedAt, 'string');
  assert.doesNotThrow(() => new Date(res.body.deletedAt).toISOString());
});
