// Workspace Secret DELETE contract conformance (GitHub issue #771).
//
// The published OpenAPI operation declares 204 for an existing secret and 404 SECRET_NOT_FOUND for a
// missing secret. The handler used to unconditionally delete and return 200 { deleted: true }, which
// made strict clients generated from the contract disagree with the runtime.
import test from 'node:test';
import assert from 'node:assert/strict';

import { FN_HANDLERS } from '../../apps/control-plane/fn-handlers.mjs';

const OWNER = { actorType: 'tenant_owner', tenantId: 'acme', sub: 'owner-1' };

const fakeStore = {
  async getWorkspace(_pool, id) { return { id, tenant_id: 'acme' }; },
  async listFnActions() { return []; },
};

function recordingVault({ exists = true } = {}) {
  const calls = [];
  return {
    calls,
    validName: (name) => /^[a-z][a-z0-9_-]{0,62}$/.test(String(name ?? '')),
    async exists(tenantId, workspaceId, name) {
      calls.push(['exists', tenantId, workspaceId, name]);
      return exists;
    },
    async delete(tenantId, workspaceId, name) {
      calls.push(['delete', tenantId, workspaceId, name]);
      return { name, deleted: true };
    },
  };
}

function ctx({ vault, params = {} }) {
  return {
    pool: {},
    store: fakeStore,
    vaultStore: vault,
    identity: OWNER,
    params: { workspaceId: 'ws-prod', secretName: 'api_key', ...params },
    callerContext: { correlationId: 'corr-771' },
  };
}

test('uc-771-delete-existing: existing workspace secret returns 204 with no body after deleting', async () => {
  const vault = recordingVault({ exists: true });
  const res = await FN_HANDLERS.secretDelete(ctx({ vault }));

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, null);
  assert.deepEqual(vault.calls, [
    ['exists', 'acme', 'ws-prod', 'api_key'],
    ['delete', 'acme', 'ws-prod', 'api_key'],
  ]);
});

test('uc-771-delete-missing: missing workspace secret returns 404 and does not call delete', async () => {
  const vault = recordingVault({ exists: false });
  const res = await FN_HANDLERS.secretDelete(ctx({ vault }));

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'SECRET_NOT_FOUND');
  assert.deepEqual(vault.calls, [
    ['exists', 'acme', 'ws-prod', 'api_key'],
  ]);
});

test('uc-771-delete-invalid-name: invalid secretName returns 400 before probing existence', async () => {
  const vault = recordingVault({ exists: true });
  const res = await FN_HANDLERS.secretDelete(ctx({ vault, params: { secretName: 'UPPER' } }));

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.deepEqual(vault.calls, []);
});
