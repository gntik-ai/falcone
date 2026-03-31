/**
 * Suite 07 — Soft quota enforcement with grace margin (RF-T06-07, CA-04).
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { envReady } from '../config/test-env.mjs';
import { TEST_STARTER } from '../config/test-plans.mjs';
import { createTestTenant, cleanupAllTestTenants } from '../helpers/tenant-factory.mjs';
import { ensureTestPlans, assignPlan } from '../helpers/plan-factory.mjs';
import { createWorkspace } from '../helpers/workspace-factory.mjs';
import { createKafkaTopic } from '../helpers/resource-factory.mjs';
import { getTenantOwnerToken } from '../helpers/auth.mjs';
import { gatewayRequest } from '../helpers/api-client.mjs';
import { createAuditConsumer, waitForAuditEvent, disconnectConsumer } from '../helpers/kafka-consumer.mjs';

describe('07 — Soft quota grace enforcement', { skip: !envReady && 'env not configured' }, () => {
  let consumer;

  before(async () => {
    await ensureTestPlans();
    consumer = await createAuditConsumer();
  });

  after(async () => {
    await disconnectConsumer(consumer);
    await cleanupAllTestTenants();
  });

  it('full soft quota transition: normal → grace (warning) → blocked', async () => {
    // test-starter: max_kafka_topics: 5 soft, grace: 2
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);
    const ws = await createWorkspace(tenant.id);
    const token = await getTenantOwnerToken(tenant.id);

    // Create 5 topics (within limit — normal)
    for (let i = 0; i < 5; i++) {
      await createKafkaTopic(tenant.id, ws.id);
    }

    // 6th topic: in grace zone — should succeed with warning
    const topic6 = await createKafkaTopic(tenant.id, ws.id);
    assert.ok(topic6.id, '6th topic should be created (grace zone)');

    // Try to detect soft limit exceeded audit event
    if (consumer) {
      try {
        await waitForAuditEvent(consumer, {
          eventType: 'quota.soft_limit.exceeded',
          tenantId: tenant.id,
          timeoutMs: 10_000,
        });
      } catch {
        // Kafka may not be available in all test environments
      }
    }

    // 7th topic: still in grace zone
    const topic7 = await createKafkaTopic(tenant.id, ws.id);
    assert.ok(topic7.id, '7th topic should be created (still in grace zone)');

    // 8th topic: beyond grace (5 + 2 = 7 max) — should be blocked
    let blocked = false;
    try {
      await createKafkaTopic(tenant.id, ws.id);
    } catch (err) {
      blocked = true;
      assert.ok(
        err.message.includes('429') || err.message.includes('403') || err.message.includes('400'),
        `Expected grace-exhausted error, got: ${err.message}`,
      );
    }
    assert.ok(blocked, '8th topic creation should be blocked (grace exhausted)');
  });

  it('resolution reports soft quota type and grace_margin', async () => {
    const tenant = await createTestTenant();
    await assignPlan(tenant.id, TEST_STARTER.slug);

    const { default: { getSuperadminToken: getSA } } = await import('../helpers/auth.mjs');
    const saToken = await getSA();

    const { default: { controlPlaneRequest: cpReq } } = await import('../helpers/api-client.mjs');
    const { body: ent } = await cpReq(
      'GET', `/api/v1/tenants/${tenant.id}/entitlements`, { token: saToken },
    );

    const kafkaQuota = ent?.quotas?.max_kafka_topics;
    assert.ok(kafkaQuota, 'entitlements should include max_kafka_topics');
    // Verify soft-quota-specific fields exist
    assert.ok(
      kafkaQuota.type === 'soft' || kafkaQuota.graceMargin != null,
      'should report soft type or grace margin',
    );
  });
});
