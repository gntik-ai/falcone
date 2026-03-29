import { compensateSaga } from './saga-compensation.mjs';
import { enrichContextWithCorrelation } from './saga-correlation.mjs';
import { sagaDefinitions } from './saga-definitions.mjs';
import { checkIdempotencyKey, recordIdempotencyResult } from './saga-idempotency.mjs';
import {
  createSagaInstance,
  createSagaStep,
  getInFlightSagas,
  listStepsForSaga,
  updateSagaStatus,
  updateStepStatus
} from './saga-state-store.mjs';

async function emitCompensationFailedAlert(payload) {
  // TODO(T05): wire real alert through events-admin.mjs when audit/alert pipeline lands.
  return payload;
}

export async function executeSaga(workflowId, params = {}, callerContext = {}) {
  const definition = sagaDefinitions.get(workflowId);
  if (!definition) {
    const error = new Error(`Workflow ${workflowId} not found`);
    error.code = 'WORKFLOW_NOT_FOUND';
    throw error;
  }

  if (definition.provisional) {
    return { status: 'not-implemented', workflowId };
  }

  const idempotencyKey = params.idempotencyKey ?? null;
  const existing = await checkIdempotencyKey(idempotencyKey, callerContext.tenantId);
  if (existing?.status === 'completed') return existing.result;
  if (existing?.status === 'in-progress') return { status: 'in-progress', sagaId: existing.sagaId };

  const correlated = enrichContextWithCorrelation(
    {
      workflowId,
      tenantId: callerContext.tenantId,
      workspaceId: callerContext.workspaceId,
      actorType: callerContext.actorType,
      actorId: callerContext.actorId ?? callerContext.actor
    },
    callerContext.correlationId
  );

  const saga = await createSagaInstance(workflowId, params, callerContext, correlated.correlationId, idempotencyKey);
  const sagaCtx = {
    sagaId: saga.saga_id,
    workflowId,
    correlationId: correlated.correlationId,
    tenantId: callerContext.tenantId,
    workspaceId: callerContext.workspaceId,
    actorType: callerContext.actorType ?? 'unknown',
    actorId: callerContext.actorId ?? callerContext.actor ?? 'unknown'
  };

  const succeededSteps = [];
  let lastStepOutput = null;

  for (const stepDef of definition.steps) {
    const step = await createSagaStep(saga.saga_id, stepDef.ordinal, stepDef.key, params);
    await updateStepStatus(step.step_id, 'executing');
    try {
      lastStepOutput = await stepDef.forward(params, sagaCtx);
      const succeeded = { ...step, status: 'succeeded', output_snapshot: lastStepOutput };
      await updateStepStatus(step.step_id, 'succeeded', lastStepOutput);
      succeededSteps.push(succeeded);
    } catch (error) {
      await updateStepStatus(step.step_id, 'failed', { message: error?.message ?? String(error) });
      const compensation = await compensateSaga(saga, succeededSteps, definition, sagaCtx);
      const status = compensation.allCompensated ? 'compensated' : 'compensation-failed';
      await updateSagaStatus(saga.saga_id, status, {
        failedStep: stepDef.key,
        reason: error?.message ?? String(error),
        uncompensatedSteps: compensation.failedSteps
      });
      if (!compensation.allCompensated) {
        await emitCompensationFailedAlert({ sagaId: saga.saga_id, workflowId, failedSteps: compensation.failedSteps });
      }
      throw error;
    }
  }

  const result = { sagaId: saga.saga_id, status: 'completed', output: lastStepOutput };
  await updateSagaStatus(saga.saga_id, 'completed', result);
  if (idempotencyKey) {
    await recordIdempotencyResult(idempotencyKey, callerContext.tenantId, saga.saga_id, result);
  }
  return result;
}

export async function recoverInFlightSagas(stalenessThresholdMs) {
  const staleSagas = await getInFlightSagas(stalenessThresholdMs);
  const failedToRecover = [];
  let recovered = 0;

  for (const saga of staleSagas) {
    try {
      const definition = sagaDefinitions.get(saga.workflow_id);
      if (!definition || definition.provisional) continue;
      const steps = await listStepsForSaga(saga.saga_id);
      const eligibleSteps = steps.filter((step) => ['succeeded', 'compensating', 'compensation-failed'].includes(step.status) === false ? false : true);
      const compensation = await compensateSaga(saga, eligibleSteps, definition, {
        sagaId: saga.saga_id,
        workflowId: saga.workflow_id,
        correlationId: saga.correlation_id,
        tenantId: saga.tenant_id,
        workspaceId: saga.workspace_id,
        actorType: saga.actor_type,
        actorId: saga.actor_id
      });
      await updateSagaStatus(saga.saga_id, compensation.allCompensated ? 'compensated' : 'compensation-failed', compensation);
      recovered += 1;
    } catch {
      failedToRecover.push(saga.saga_id);
    }
  }

  return { recovered, failedToRecover };
}
