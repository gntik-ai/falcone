import test from 'node:test';
import assert from 'node:assert/strict';
import { backoffDelay, compensateSaga } from '../../apps/control-plane/src/saga/saga-compensation.mjs';

test('compensateSaga runs successful steps in reverse order', async () => {
  const order = [];
  const result = await compensateSaga(
    { saga_id: 's1' },
    [
      { step_id: 'a', step_ordinal: 1, step_key: 'one', status: 'succeeded', input_snapshot: {}, output_snapshot: {} },
      { step_id: 'b', step_ordinal: 2, step_key: 'two', status: 'succeeded', input_snapshot: {}, output_snapshot: {} },
      { step_id: 'c', step_ordinal: 3, step_key: 'three', status: 'succeeded', input_snapshot: {}, output_snapshot: {} }
    ],
    {
      steps: [
        { ordinal: 1, key: 'one', compensate: async () => order.push('one') },
        { ordinal: 2, key: 'two', compensate: async () => order.push('two') },
        { ordinal: 3, key: 'three', compensate: async () => order.push('three') }
      ]
    },
    {}
  );

  assert.deepEqual(order, ['three', 'two', 'one']);
  assert.equal(result.allCompensated, true);
});

test('compensateSaga retries and can fail permanently', async () => {
  let attempts = 0;
  const okResult = await compensateSaga(
    { saga_id: 's1' },
    [{ step_id: 'x', step_ordinal: 1, step_key: 'flaky', status: 'succeeded', input_snapshot: {}, output_snapshot: {} }],
    { steps: [{ ordinal: 1, key: 'flaky', compensate: async () => { attempts += 1; if (attempts < 2) throw new Error('retry'); } }] },
    {}
  );
  assert.equal(okResult.allCompensated, true);
  assert.equal(attempts, 2);

  const badResult = await compensateSaga(
    { saga_id: 's1' },
    [{ step_id: 'y', step_ordinal: 1, step_key: 'bad', status: 'succeeded', input_snapshot: {}, output_snapshot: {} }],
    { steps: [{ ordinal: 1, key: 'bad', compensate: async () => { throw new Error('boom'); } }] },
    {}
  );
  assert.equal(badResult.allCompensated, false);
  assert.deepEqual(badResult.failedSteps, ['bad']);
});

test('compensateSaga skips already compensated steps and backoffDelay is exponential', async () => {
  let called = false;
  const result = await compensateSaga(
    { saga_id: 's1' },
    [{ step_id: 'z', step_ordinal: 1, step_key: 'done', status: 'compensated', input_snapshot: {}, output_snapshot: {} }],
    { steps: [{ ordinal: 1, key: 'done', compensate: async () => { called = true; } }] },
    {}
  );
  assert.equal(called, false);
  assert.equal(result.allCompensated, true);
  assert.equal(backoffDelay(1, { baseDelayMs: 500, backoffMultiplier: 2, maxDelayMs: 10000 }), 1000);
  assert.equal(backoffDelay(10, { baseDelayMs: 500, backoffMultiplier: 2, maxDelayMs: 10000 }), 10000);
});
