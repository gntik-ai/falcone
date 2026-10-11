import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFunctionsFamilySource } from '../../scripts/lib/functions-family-source.mjs';

test('family regeneration retains the unified shared Idempotency-Key contract', () => {
  const document = { paths: {}, components: { parameters: { IdempotencyKey: { required: false, description: 'Optional 24h tenant/principal replay' } } }, info: {} };
  const staleFamily = { paths: {}, components: { parameters: { IdempotencyKey: { required: true, description: 'Stale required key' } } } };
  const merged = mergeFunctionsFamilySource(document, staleFamily, '1.22.0');
  assert.deepEqual(merged.components.parameters.IdempotencyKey, document.components.parameters.IdempotencyKey);
});
