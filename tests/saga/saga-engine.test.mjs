import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSaga, recoverInFlightSagas } from '../../apps/control-plane/src/saga/saga-engine.mjs';

test('executeSaga completes WF-CON-001 happy path', async () => {
  const result = await executeSaga('WF-CON-001', { idempotencyKey: 'k-new' }, {
    tenantId: 't1',
    workspaceId: 'w1',
    actorType: 'svc',
    actorId: 'a1',
    correlationId: 'parent'
  });

  assert.equal(result.status, 'completed');
  assert.ok(result.sagaId);
  assert.equal(result.output.step, 'update-membership-record');
});

test('executeSaga returns provisional status for WF-CON-005', async () => {
  const result = await executeSaga('WF-CON-005', {}, { tenantId: 't1' });
  assert.deepEqual(result, { status: 'not-implemented', workflowId: 'WF-CON-005' });
});

test('executeSaga rejects unknown workflows', async () => {
  await assert.rejects(() => executeSaga('WF-CON-999', {}, { tenantId: 't1' }), /not found/);
});

test('recoverInFlightSagas returns summary', async () => {
  const result = await recoverInFlightSagas(60_000);
  assert.equal(typeof result.recovered, 'number');
  assert.ok(Array.isArray(result.failedToRecover));
});
