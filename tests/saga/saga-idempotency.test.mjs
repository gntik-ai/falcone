import test from 'node:test';
import assert from 'node:assert/strict';
import { checkIdempotencyKey, recordIdempotencyResult } from '../../apps/control-plane/src/saga/saga-idempotency.mjs';

test('unknown idempotency keys return null when adapter has no rows', async () => {
  assert.equal(await checkIdempotencyKey('unknown', 't1'), null);
});

test('recordIdempotencyResult resolves without throwing', async () => {
  await recordIdempotencyResult('k1', 't1', 's1', { ok: true });
  assert.ok(true);
});
