// Black-box test suite for change scope-secret-consumer-status-to-tenant.
// Drives the PUBLIC action entrypoint (`main`) only — fake db and fake repo
// are injected via params (same pattern as secrets-rotation-cross-tenant.test.mjs).
//
// Tests: bbx-sec-consumer-status-cross-tenant-01 through -04
import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../packages/provisioning-orchestrator/src/actions/secret-rotation-consumer-status.mjs';

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const tenantOwnerA = { sub: 'user:a', roles: ['tenant-owner'], tenantId: TENANT_A };
const platformCaller = { sub: 'svc:platform', roles: ['platform-operator'], tenantId: null };

function fakeDb() {
  return {};
}

// Builds a fake repo that tracks call counts for side-effect assertions.
// getActiveVersion returns the supplied activeVersionRow (may be null).
function fakeRepo(activeVersionRow) {
  const spy = {
    listConsumersCalled: 0,
    listPendingPropagationsCalled: 0,
    async getActiveVersion(_db, _secretPath) {
      return activeVersionRow;
    },
    async listConsumers(_db, _secretPath) {
      spy.listConsumersCalled += 1;
      return [{ consumer_id: 'c1', reload_mechanism: 'env' }];
    },
    async listPendingPropagations(_db, _opts) {
      spy.listPendingPropagationsCalled += 1;
      return [];
    }
  };
  return spy;
}

// bbx-sec-consumer-status-cross-tenant-01
// Tenant A caller requests consumer status for a secretPath owned by tenant B.
// Must get 403/404 and NEITHER listConsumers NOR listPendingPropagations called.
test('bbx-sec-consumer-status-cross-tenant-01: tenant A cannot read tenant B consumer status', async () => {
  const repo = fakeRepo({ id: 'v1', vault_version: 1, tenant_id: TENANT_B });
  const result = await main({
    auth: tenantOwnerA,
    secretPath: `tenant/${TENANT_B}/db-password`,
    db: fakeDb(),
    repo
  });
  assert.ok(
    result?.error?.status === 403 || result?.error?.status === 404,
    `expected 403 or 404, got ${result?.error?.status}`
  );
  assert.equal(repo.listConsumersCalled, 0, 'listConsumers must NOT be called on cross-tenant request');
  assert.equal(repo.listPendingPropagationsCalled, 0, 'listPendingPropagations must NOT be called on cross-tenant request');
});

// bbx-sec-consumer-status-cross-tenant-02
// Same-tenant caller (A) reads their own consumer status — must succeed with data.
test('bbx-sec-consumer-status-cross-tenant-02: same-tenant caller reads their own consumer status', async () => {
  const repo = fakeRepo({ id: 'v1', vault_version: 1, tenant_id: TENANT_A });
  const result = await main({
    auth: tenantOwnerA,
    secretPath: `tenant/${TENANT_A}/db-password`,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error, undefined, `must not return an error; got ${JSON.stringify(result?.error)}`);
  assert.ok(Array.isArray(result?.consumers), 'result.consumers must be an array');
  assert.equal(repo.listConsumersCalled, 1, 'listConsumers must be called for same-tenant request');
});

// bbx-sec-consumer-status-cross-tenant-03
// Platform-scoped caller reads any tenant's consumer status — must succeed.
test('bbx-sec-consumer-status-cross-tenant-03: platform-scoped caller reads any tenant consumer status', async () => {
  const repo = fakeRepo({ id: 'v1', vault_version: 1, tenant_id: TENANT_B });
  const result = await main({
    auth: platformCaller,
    secretPath: `tenant/${TENANT_B}/db-password`,
    db: fakeDb(),
    repo
  });
  assert.equal(result?.error, undefined, `platform caller must not receive an error; got ${JSON.stringify(result?.error)}`);
  assert.ok(Array.isArray(result?.consumers), 'result.consumers must be an array');
});

// bbx-sec-consumer-status-cross-tenant-04
// Tenant-scoped caller, secretPath has no active version (getActiveVersion returns null).
// Must get 403/404 and NEITHER listConsumers NOR listPendingPropagations called.
test('bbx-sec-consumer-status-cross-tenant-04: no active version returns 403/404 for tenant-scoped caller', async () => {
  const repo = fakeRepo(null);
  const result = await main({
    auth: tenantOwnerA,
    secretPath: `tenant/${TENANT_A}/db-password`,
    db: fakeDb(),
    repo
  });
  assert.ok(
    result?.error?.status === 403 || result?.error?.status === 404,
    `expected 403 or 404, got ${result?.error?.status}`
  );
  assert.equal(repo.listConsumersCalled, 0, 'listConsumers must NOT be called when no active version');
  assert.equal(repo.listPendingPropagationsCalled, 0, 'listPendingPropagations must NOT be called when no active version');
});
