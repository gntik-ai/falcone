/**
 * Black-box test for issue #778.
 *
 * The Service Accounts page now depends on GET /v1/workspaces/{workspaceId}/service-accounts
 * as the workspace source of truth, so the backend collection route must return listable
 * service-account items rather than only raw local rows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCAL_HANDLERS } from '../../deploy/kind/control-plane/b-handlers.mjs';

function handlerCtx() {
  const calls = { listServiceAccounts: [] };
  const store = {
    async getWorkspace() {
      return { id: 'wrk_1', tenant_id: 'ten_1', slug: 'dev' };
    },
    async getTenant() {
      return { id: 'ten_1', iam_realm: 'tenant-realm' };
    },
    async listServiceAccounts(_pool, workspaceId) {
      calls.listServiceAccounts.push(workspaceId);
      return {
        items: [
          {
            id: 'sa_1',
            workspace_id: 'wrk_1',
            tenant_id: 'ten_1',
            iam_realm: 'tenant-realm',
            kc_client_id: 'sa-dev-ops',
            display_name: 'Ops SA',
            status: 'active',
            created_at: '2026-06-30T00:00:00.000Z',
            created_by: 'usr_1'
          }
        ],
        total: 1
      };
    }
  };

  return {
    calls,
    ctx: {
      pool: {},
      store,
      identity: { sub: 'owner-1', actorType: 'tenant_owner', tenantId: 'ten_1' },
      params: { workspaceId: 'wrk_1' },
      body: {}
    }
  };
}

test('bbx-778-01: listServiceAccounts returns backend collection items in console-listable shape', async () => {
  const h = handlerCtx();
  const res = await LOCAL_HANDLERS.listServiceAccounts(h.ctx);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(h.calls.listServiceAccounts, ['wrk_1']);
  assert.equal(res.body.total, 1);
  assert.equal(res.body.page.size, 1);
  assert.equal(res.body.items[0].serviceAccountId, 'sa_1');
  assert.equal(res.body.items[0].displayName, 'Ops SA');
  assert.equal(res.body.items[0].iamBinding.clientId, 'sa-dev-ops');
  assert.equal(res.body.items[0].credentialStatus.state, 'active');
  assert.equal(res.body.items[0].id, 'sa_1', 'legacy raw row id remains for compatibility');
});
