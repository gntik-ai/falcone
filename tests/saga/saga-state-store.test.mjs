import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendCompensationLog,
  createSagaInstance,
  createSagaStep,
  getInFlightSagas,
  updateSagaStatus,
  updateStepStatus
} from '../../apps/control-plane/src/saga/saga-state-store.mjs';

test('createSagaInstance and createSagaStep build required records', async () => {
  const saga = await createSagaInstance('WF-CON-001', { foo: 'bar' }, { tenantId: 't1', actorType: 'svc', actorId: 'a1' }, 'corr', 'idem');
  const step = await createSagaStep(saga.saga_id, 1, 'step-1', { foo: 'bar' });

  assert.equal(saga.workflow_id, 'WF-CON-001');
  assert.equal(saga.correlation_id, 'corr');
  assert.equal(saga.tenant_id, 't1');
  assert.equal(step.step_ordinal, 1);
  assert.equal(step.step_key, 'step-1');
});

test('update helpers and in-flight query resolve without throwing', async () => {
  await updateSagaStatus('missing', 'completed', { ok: true });
  await updateStepStatus('missing', 'succeeded', { ok: true });
  await appendCompensationLog('s1', 'st1', 1, 'succeeded', null);
  const rows = await getInFlightSagas(60_000);
  assert.ok(Array.isArray(rows));
});
