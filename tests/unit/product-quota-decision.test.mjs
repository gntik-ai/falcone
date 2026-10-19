import test from 'node:test';
import assert from 'node:assert/strict';
import { decideProductQuota, PRODUCT_QUOTA_HANDLERS } from '../../apps/control-plane/product-quota.mjs';
import { resolveEffectiveLimit } from '../../packages/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs';
import { evaluateQuotaDecision } from '../../packages/provisioning-orchestrator/src/models/quota-enforcement.mjs';
import { listAllDimensions } from '../../packages/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs';

import { quotaPool } from '../helpers/product-quota-fixture.mjs';

const load = async () => ({ resolveEffectiveLimit, evaluateQuotaDecision, listAllDimensions });
const key = 'codewiki_max_projects';
const decide = (pool, args = {}) => decideProductQuota(pool, { tenantId: 'tenant-a', dimensionKey: key, currentUsage: 0, requested: 1, ...args }, { load });

test('hard limits allow an exact fill, reject one extra, and resolve plan over catalog default', async () => {
  const defaultDecision = await decide(quotaPool(), { currentUsage: 1, requested: 2 });
  assert.equal(defaultDecision.allowed, true);
  assert.equal(defaultDecision.effectiveLimit, 3);
  assert.equal(defaultDecision.source, 'default');
  assert.equal(defaultDecision.currentUsage, 1);
  assert.equal(defaultDecision.projectedUsage, 3);
  assert.equal((await decide(quotaPool(), { currentUsage: 2, requested: 2 })).allowed, false);
  const plan = quotaPool({ plan: { [key]: 7 } });
  const exact = await decide(plan, { currentUsage: 5, requested: 2 });
  assert.equal(exact.allowed, true);
  assert.equal(exact.effectiveLimit, 7);
  assert.equal(exact.source, 'plan');
  assert.equal((await decide(plan, { currentUsage: 6, requested: 2 })).allowed, false);
});

test('only known product keys are accepted; catalog and resolver faults fail closed', async () => {
  for (const dimensionKey of ['max_workspaces', 'other', 'codewiki_unknown', null]) {
    await assert.rejects(decide(quotaPool(), { dimensionKey }), { code: 'INVALID_DIMENSION_KEY' });
  }
  for (const failure of ['quota_dimension_catalog', 'tenant_plan_assignments', 'quota_overrides']) {
    assert.deepEqual(await decide(quotaPool({ failure })), { unavailable: true });
  }
  assert.deepEqual(await decideProductQuota({}, { tenantId: 'tenant-a', dimensionKey: key, currentUsage: 0 }, {
    load: async () => { throw new Error('loader unavailable'); },
  }), { unavailable: true });
});

test('soft grace warns below its ceiling and denies at or above it; unlimited permits any usage', async () => {
  const pool = quotaPool({ plan: { [key]: 3 }, types: { [key]: { type: 'soft', graceMargin: 2 } } });
  const grace = await decide(pool, { currentUsage: 3 });
  assert.equal(grace.allowed, true);
  assert.equal(grace.decision, 'soft_grace_allowed');
  assert.equal(grace.effectiveCeiling, 5);
  assert.equal(grace.warning, 'Soft quota exceeded. Usage 4/3 (grace ceiling: 5).');
  assert.equal((await decide(pool, { currentUsage: 4 })).allowed, false);
  assert.equal((await decide(pool, { currentUsage: 5 })).allowed, false);
  const unlimited = await decide(quotaPool({ plan: { [key]: -1 } }), { currentUsage: 100000, requested: 1000 });
  assert.equal(unlimited.allowed, true);
  assert.equal(unlimited.decision, 'unlimited');
  assert.equal(unlimited.effectiveCeiling, -1);
});

test('repository bytes are a repeatable snapshot ceiling and require zero current usage', async () => {
  const dimensionKey = 'codewiki_max_repository_bytes';
  const pool = quotaPool();
  for (let i = 0; i < 2; i++) {
    const result = await decide(pool, { dimensionKey, requested: 419430400 });
    assert.equal(result.allowed, true);
    assert.equal(result.effectiveLimit, 524288000);
    assert.equal(result.projectedUsage, 419430400);
  }
  assert.equal((await decide(pool, { dimensionKey, requested: 629145600 })).allowed, false);
  await assert.rejects(decide(pool, { dimensionKey, currentUsage: 1 }), { code: 'VALIDATION_ERROR' });
});

test('denial records exactly one complete enforcement row; allowed decisions record none', async () => {
  const pool = quotaPool();
  const ctx = { pool, params: { workspaceId: 'ws-a' }, identity: { tenantId: 'tenant-a', actorType: 'tenant_owner', sub: 'actor-a' },
    callerContext: { correlationId: 'corr-a' }, body: { dimensionKey: key, currentUsage: 2, attemptedAction: 'project.create' } };
  const allowed = await PRODUCT_QUOTA_HANDLERS.productQuotaDecision(ctx);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.allowed, true);
  assert.equal(pool.logs.length, 0);
  const denied = await PRODUCT_QUOTA_HANDLERS.productQuotaDecision({ ...ctx, body: { ...ctx.body, currentUsage: 3 } });
  assert.equal(denied.statusCode, 200);
  assert.equal(denied.body.allowed, false);
  assert.equal(pool.logs.length, 1);
  assert.deepEqual(pool.logs[0].slice(1, 8), ['tenant-a', 'ws-a', key, 'project.create', 3, 3, 'hard']);
  assert.deepEqual(pool.logs[0].slice(12, 14), ['actor-a', 'corr-a']);
});

test('malformed resolver results fail closed rather than becoming unlimited', async () => {
  for (const effective of [{}, { effectiveLimit: NaN }, { effectiveLimit: Infinity }, { effectiveLimit: -2 }, null]) {
    const result = await decideProductQuota(quotaPool(), { tenantId: 'tenant-a', dimensionKey: key, currentUsage: 0 }, {
      load: async () => ({ listAllDimensions, evaluateQuotaDecision, resolveEffectiveLimit: async () => effective }),
    });
    assert.deepEqual(result, { unavailable: true });
  }
});

test('product dimensions retain not_enforced posture and do not expand platform gates', async () => {
  const { ENFORCED_DIMENSION_KEYS } = await import('../../apps/control-plane/dimension-quota.mjs');
  const { dimensionsFromLimits } = await import('../../apps/control-plane/metrics-handlers.mjs');
  assert.deepEqual([...ENFORCED_DIMENSION_KEYS], ['max_workspaces', 'max_kafka_topics', 'max_mongo_databases', 'max_functions', 'max_storage_bytes']);
  const keys = ['codewiki_max_projects', 'codewiki_max_concurrent_runs', 'codewiki_max_queued_runs',
    'codewiki_max_indexed_repositories', 'codewiki_max_wiki_pages', 'codewiki_max_repository_bytes'];
  const { dimensions } = dimensionsFromLimits(keys.map(dimensionKey => ({ dimensionKey, effectiveValue: 3 })));
  assert.ok(dimensions.every(row => row.policyMode === 'not_enforced'));
});
