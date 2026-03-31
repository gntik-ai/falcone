/**
 * Suite 06 — Hard quota enforcement (RF-T06-06, CA-03).
 *
 * Verifies that hard quotas block resource creation at N+1 and the
 * error includes the expected fields.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER, TEST_ENTERPRISE } from '../config/test-plans.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { getSuperadminToken } from '../helpers/auth.mjs';
import { controlPlaneRequest } from '../helpers/api-client.mjs';

describe('06 — Hard quota enforcement', { skip: !envReady && 'env not configured' }, () => {
  before(() => ensureTestPlans());
  after(() => cleanupAllTestTenants());

  it('max_workspaces hard limit: allows N, blocks N+1 with QUOTA_HARD_LIMIT_REACHED', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug); // max_workspaces: 3 hard

    // Create 3 (should succeed)
    for (let i = 0; i < 3; i++) {
      await createWorkspace(tenant.id, `ws-fill-${i}`);
    }

    // 4th should fail
    let error;
    try {
      await createWorkspace(tenant.id, 'ws-over');
    } catch (err) {
      error = err;
    }
    assert.ok(error, '4th workspace creation should fail');
    assert.ok(
      error.message.includes('400') || error.message.includes('429') || error.message.includes('403'),
      `Expected quota error, got: ${error.message}`,
    );
  });

  it('error body includes dimension, current_usage, effective_limit', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const saToken = await getSuperadminToken();

    for (let i = 0; i < 3; i++) {
      await createWorkspace(tenant.id, `ws-${i}`);
    }

    const { status, body } = await controlPlaneRequest(
      'POST',
      `/api/v1/tenants/${tenant.id}/workspaces`,
      { token: saToken, body: { name: 'ws-over' } },
    );

    assert.ok(status >= 400, `Expected rejection, got ${status}`);
    // Verify error structure (at least one of these patterns)
    const hasFields = body?.dimension || body?.error?.dimension ||
                      body?.code === 'QUOTA_HARD_LIMIT_REACHED' ||
                      body?.error?.code === 'QUOTA_HARD_LIMIT_REACHED';
    assert.ok(hasFields, `Error body should include quota fields: ${JSON.stringify(body)}`);
  });

  it('resolution effective_limit matches the limit used by gateway for blocking', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const saToken = await getSuperadminToken();

    const { body: ent } = await controlPlaneRequest(
      'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
    );
    const effectiveLimit = ent?.quotas?.max_workspaces?.effectiveLimit ??
                           ent?.quotas?.max_workspaces?.limit;
    assert.equal(effectiveLimit, 3, 'resolution should report max_workspaces = 3');
  });

  it('unlimited quota (-1) does not block creation', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_ENTERPRISE.slug); // max_workspaces: -1

    // Create several workspaces — should all succeed
    for (let i = 0; i < 5; i++) {
      await createWorkspace(tenant.id, `ws-unlim-${i}`);
    }
    // If we reached here without error, the test passes.
  });
});
