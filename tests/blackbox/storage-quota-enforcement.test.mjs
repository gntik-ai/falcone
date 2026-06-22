/**
 * Black-box tests for per-workspace storage capacity quota enforcement
 * (add-storage-capacity-quota-enforcement, #674, P5/quota).
 *
 * The defect: `storageProvisionBucket` provisioned buckets with NO admission (past
 * maxBuckets=8 returned all 201), and `storageWorkspaceUsage` hardcoded every
 * dimension's limit/remaining/utilizationPercent to null. The fix adds a kind-CP
 * quota-decision module `storage-quota.mjs` (inline math, error code
 * STORAGE_QUOTA_EXCEEDED / HTTP 409, default bucket limit 8) and wires it into the two
 * handlers + the byte-quota upload path, populating the usage limits.
 *
 * These tests drive the PURE decision helpers directly via the injectable `opts.load`
 * seam (the runtime resolves limits from STORAGE_MAX_BUCKETS / STORAGE_MAX_BYTES; tests
 * inject them) — proving the admission boundary and the usage-reporting math without a
 * live cluster. The live create-path 409 + populated usage is confirmed by the checker.
 *
 * bbx-674-01..03: bucket-count admission — under/at/over the limit (Scenario A)
 * bbx-674-04:     bucket-count unlimited (no limit) → allow
 * bbx-674-05:     loader error → fail OPEN (governance unavailable never blocks)
 * bbx-674-06..08: byte admission — under/over the limit, and unset → allow (Scenario B)
 * bbx-674-09..11: dimensionStatus — populated when limited, null when unlimited (Scenario C)
 * bbx-674-12:     usageLimits resolves env defaults (bucket default 8, bytes null)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkBucketQuota,
  checkByteQuota,
  usageLimits,
  dimensionStatus,
  DEFAULT_MAX_BUCKETS,
  STORAGE_QUOTA_EXCEEDED,
} from '../../deploy/kind/control-plane/storage-quota.mjs';

// An injectable loader returning fixed effective limits (mirrors what the env loader yields).
const limits = ({ maxBuckets = null, maxBytes = null } = {}) => () => ({ maxBuckets, maxBytes });

// ---------------------------------------------------------------------------
// Scenario A — bucket-count admission
// ---------------------------------------------------------------------------
test('bbx-674-01: bucket count below the limit is allowed', () => {
  const d = checkBucketQuota(5, { load: limits({ maxBuckets: 8 }) });
  assert.equal(d.allowed, true, '5 < 8 must allow the 6th bucket');
  assert.equal(d.remaining, 3);
  assert.equal(d.limit, 8);
});

test('bbx-674-02: bucket count AT the limit denies the next provision (STORAGE_QUOTA_EXCEEDED)', () => {
  const d = checkBucketQuota(8, { load: limits({ maxBuckets: 8 }) });
  assert.equal(d.allowed, false, 'provisioning the 9th bucket under maxBuckets=8 must be denied');
  assert.equal(d.code, STORAGE_QUOTA_EXCEEDED);
  assert.equal(d.decision, 'hard_blocked');
  assert.equal(d.limit, 8);
});

test('bbx-674-03: one BELOW the limit is the last allowed provision', () => {
  // 7 buckets -> the 8th is allowed; 8 buckets -> the 9th is denied (boundary).
  assert.equal(checkBucketQuota(7, { load: limits({ maxBuckets: 8 }) }).allowed, true);
  assert.equal(checkBucketQuota(8, { load: limits({ maxBuckets: 8 }) }).allowed, false);
});

test('bbx-674-04: no bucket limit configured (unlimited) always allows', () => {
  const d = checkBucketQuota(10_000, { load: limits({ maxBuckets: null }) });
  assert.equal(d.allowed, true, 'unlimited bucket count must never deny');
  assert.equal(d.limit, null);
});

test('bbx-674-05: loader error fails OPEN (never blocks a provision)', () => {
  const failing = () => { throw new Error('quota model unavailable'); };
  const d = checkBucketQuota(9999, { load: failing });
  assert.equal(d.allowed, true, 'an unavailable quota model must never block a provision');
  assert.equal(d.decision, 'quota_unavailable');
});

// ---------------------------------------------------------------------------
// Scenario B — byte admission
// ---------------------------------------------------------------------------
test('bbx-674-06: upload within the byte limit is allowed', () => {
  const d = checkByteQuota(900, 50, { load: limits({ maxBytes: 1000 }) });
  assert.equal(d.allowed, true, '900 + 50 <= 1000 must be allowed');
  assert.equal(d.remaining, 50);
});

test('bbx-674-07: upload that would exceed the byte limit is denied (STORAGE_QUOTA_EXCEEDED)', () => {
  const d = checkByteQuota(900, 200, { load: limits({ maxBytes: 1000 }) });
  assert.equal(d.allowed, false, '900 + 200 > 1000 must be denied');
  assert.equal(d.code, STORAGE_QUOTA_EXCEEDED);
});

test('bbx-674-08: no byte limit configured (unset) always allows', () => {
  const d = checkByteQuota(1e12, 1e12, { load: limits({ maxBytes: null }) });
  assert.equal(d.allowed, true, 'unlimited bytes must never deny');
  assert.equal(d.limit, null);
});

// ---------------------------------------------------------------------------
// Scenario C — usage dimension reporting
// ---------------------------------------------------------------------------
test('bbx-674-09: dimensionStatus is fully populated when a limit is configured', () => {
  const s = dimensionStatus(2, 8);
  assert.deepEqual(s, { used: 2, limit: 8, remaining: 6, utilizationPercent: 25 });
});

test('bbx-674-10: dimensionStatus clamps remaining at 0 and rounds utilization', () => {
  const over = dimensionStatus(10, 8);
  assert.equal(over.remaining, 0, 'remaining must clamp at 0 when used > limit');
  assert.equal(over.utilizationPercent, 125, 'utilization is round(used/limit*100)');
  const third = dimensionStatus(1, 3);
  assert.equal(third.utilizationPercent, 33, 'round(1/3*100) === 33');
});

test('bbx-674-11: dimensionStatus reports null only when genuinely unlimited', () => {
  const s = dimensionStatus(5, null);
  assert.deepEqual(s, { used: 5, limit: null, remaining: null, utilizationPercent: null });
});

// ---------------------------------------------------------------------------
// usageLimits / env defaults
// ---------------------------------------------------------------------------
test('bbx-674-12: usageLimits resolves env defaults (bucket default 8, bytes unlimited)', () => {
  // Default loader reads process.env; with neither var set, bucket default applies, bytes null.
  const saved = { b: process.env.STORAGE_MAX_BUCKETS, by: process.env.STORAGE_MAX_BYTES };
  delete process.env.STORAGE_MAX_BUCKETS;
  delete process.env.STORAGE_MAX_BYTES;
  try {
    const u = usageLimits();
    assert.equal(u.maxBuckets, DEFAULT_MAX_BUCKETS, 'default bucket limit must be 8');
    assert.equal(u.maxBytes, null, 'byte limit defaults to unlimited (null)');
  } finally {
    if (saved.b === undefined) delete process.env.STORAGE_MAX_BUCKETS; else process.env.STORAGE_MAX_BUCKETS = saved.b;
    if (saved.by === undefined) delete process.env.STORAGE_MAX_BYTES; else process.env.STORAGE_MAX_BYTES = saved.by;
  }
});

test('bbx-674-13: a configured STORAGE_MAX_BUCKETS env overrides the default', () => {
  const saved = process.env.STORAGE_MAX_BUCKETS;
  process.env.STORAGE_MAX_BUCKETS = '3';
  try {
    assert.equal(usageLimits().maxBuckets, 3);
    assert.equal(checkBucketQuota(3, {}).allowed, false, 'at env limit 3 the 4th bucket is denied');
    assert.equal(checkBucketQuota(2, {}).allowed, true, 'below env limit 3 is allowed');
  } finally {
    if (saved === undefined) delete process.env.STORAGE_MAX_BUCKETS; else process.env.STORAGE_MAX_BUCKETS = saved;
  }
});

test('bbx-674-14: a malformed STORAGE_MAX_BUCKETS fails OPEN (treated as unlimited)', () => {
  const saved = process.env.STORAGE_MAX_BUCKETS;
  process.env.STORAGE_MAX_BUCKETS = 'not-a-number';
  try {
    assert.equal(usageLimits().maxBuckets, null, 'malformed limit collapses to null (unlimited)');
    assert.equal(checkBucketQuota(9999, {}).allowed, true, 'malformed limit must never block a provision');
  } finally {
    if (saved === undefined) delete process.env.STORAGE_MAX_BUCKETS; else process.env.STORAGE_MAX_BUCKETS = saved;
  }
});
