import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDimensionQuota, ENFORCED_DIMENSION_KEYS } from '../../apps/control-plane/dimension-quota.mjs';
import { checkTenantByteQuota, tenantByteLimit } from '../../apps/control-plane/storage-quota.mjs';
import { dimensionsFromLimits } from '../../apps/control-plane/metrics-handlers.mjs';
import { defaults, load, governancePool, tenantId } from '../helpers/live-quota-fixture.mjs';

for (const [key, limit] of Object.entries(defaults)) {
  test(`${key}: default allows limit-1 and denies at limit`, async () => {
    const below = await checkDimensionQuota(governancePool(), tenantId, key, limit - 1, { load });
    assert.equal(below.allowed, true);
    const at = await checkDimensionQuota(governancePool(), tenantId, key, limit, { load });
    assert.equal(at.allowed, false);
    assert.equal(at.decision, 'hard_blocked');
    assert.equal(at.effectiveLimit, limit);
    assert.equal(at.dimensionKey, key);
    assert.equal(at.source, 'default');
  });
  for (const source of ['plan', 'override']) {
    for (const value of [limit - 1, limit + 1]) {
      test(`${key}: ${source} value ${value} takes precedence at both boundaries`, async () => {
        const opts = source === 'plan' ? { plan: { [key]: value } }
          : { plan: { [key]: value + 10 }, overrides: { [key]: value } };
        const pool = governancePool(opts);
        const below = await checkDimensionQuota(pool, tenantId, key, value - 1, { load });
        const at = await checkDimensionQuota(pool, tenantId, key, value, { load });
        assert.equal(below.allowed, true);
        assert.equal(at.allowed, false);
        assert.equal(at.source, source);
        assert.equal(at.effectiveLimit, value);
      });
    }
  }
  test(`${key}: unlimited sentinel allows high usage`, async () => {
    const decision = await checkDimensionQuota(governancePool({ overrides: { [key]: -1 } }), tenantId, key, limit * 2, { load });
    assert.equal(decision.allowed, true);
    assert.equal(decision.decision, 'unlimited');
  });
}

test('loader, resolver and unavailable meters fail open', async () => {
  const throwing = async () => { throw new Error('unavailable'); };
  for (const [usage, options] of [[99, { load: throwing }], [99, { load: async () => ({ resolveEffectiveLimit: throwing }) }], [null, { load }], [throwing, { load }]]) {
    const decision = await checkDimensionQuota(governancePool(), tenantId, 'max_kafka_topics', usage, options);
    assert.equal(decision.allowed, true);
    assert.equal(decision.decision, 'quota_unavailable');
  }
});

test('byte admission permits exact fill and rejects one byte past the resolved limit', async () => {
  const pool = governancePool({ plan: { max_storage_bytes: 100 } });
  assert.equal((await checkTenantByteQuota(pool, tenantId, 90, 10, { load })).allowed, true);
  const blocked = await checkTenantByteQuota(pool, tenantId, 90, 11, { load });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.currentUsage, 90);
  assert.equal(blocked.effectiveLimit, 100);
  assert.equal((await checkTenantByteQuota(pool, tenantId, null, 11, { load })).decision, 'quota_unavailable');
});

test('unlimited bytes skip scans and usage reports null only for the sentinel', async () => {
  const pool = governancePool({ overrides: { max_storage_bytes: -1 } });
  assert.equal((await checkTenantByteQuota(pool, tenantId, () => assert.fail('must not scan'), 50, { load })).decision, 'unlimited');
  assert.equal((await tenantByteLimit(pool, tenantId, { load })).maxBytes, null);
  assert.equal((await tenantByteLimit(governancePool(), tenantId, { load })).maxBytes, defaults.max_storage_bytes);
});

test('posture marks exactly the five live gates enforced and the other dimensions not_enforced', () => {
  const keys = [...ENFORCED_DIMENSION_KEYS, 'max_flows', 'max_api_keys', 'max_pg_databases', 'max_workspace_members'];
  const { dimensions } = dimensionsFromLimits(keys.map(dimensionKey => ({ dimensionKey, effectiveValue: 10, quotaType: 'hard', currentUsage: 0, usageStatus: 'within_limit' })));
  for (const item of dimensions) assert.equal(item.policyMode, ENFORCED_DIMENSION_KEYS.has(item.dimensionId) ? 'enforced' : 'not_enforced');
  assert.equal(dimensionsFromLimits([{ dimensionKey: 'max_functions', effectiveValue: -1 }]).dimensions[0].policyMode, 'unbounded');
});
