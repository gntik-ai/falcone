import { getSagaById, listSagasForTenantRecordset, listStepsForSaga } from './saga-state-store.mjs';

function toStatusResponse(saga, steps) {
  const currentStep = steps.find((step) => ['executing', 'compensating'].includes(step.status)) ?? null;
  return {
    sagaId: saga.saga_id,
    workflowId: saga.workflow_id,
    correlationId: saga.correlation_id,
    status: saga.status,
    currentStep: currentStep
      ? { ordinal: currentStep.step_ordinal, key: currentStep.step_key, status: currentStep.status }
      : null,
    steps: steps.map((step) => ({
      ordinal: step.step_ordinal,
      key: step.step_key,
      status: step.status,
      updatedAt: step.updated_at
    })),
    startedAt: saga.created_at,
    updatedAt: saga.updated_at,
    errorSummary: saga.status === 'compensation-failed'
      ? {
          failedStep: saga.error_summary?.failedStep ?? 'unknown',
          reason: saga.error_summary?.reason ?? 'compensation failed',
          uncompensatedSteps: saga.error_summary?.uncompensatedSteps ?? []
        }
      : null
  };
}

export async function getSagaStatus(sagaId, callerContext = {}) {
  const saga = await getSagaById(sagaId);
  if (!saga) return null;
  if (callerContext.role !== 'superadmin' && saga.tenant_id !== callerContext.tenantId) {
    const error = new Error('Cross-tenant saga access denied');
    error.code = 'FORBIDDEN';
    throw error;
  }
  const steps = await listStepsForSaga(sagaId);
  return toStatusResponse(saga, steps);
}

export async function listSagasForTenant(tenantId, filters = {}, callerContext = {}) {
  if (callerContext.role !== 'superadmin' && tenantId !== callerContext.tenantId) {
    const error = new Error('Cross-tenant saga access denied');
    error.code = 'FORBIDDEN';
    throw error;
  }
  const page = await listSagasForTenantRecordset(tenantId, {
    workflowId: filters.workflowId,
    status: filters.status,
    limit: filters.limit ?? 20,
    offset: filters.offset ?? 0
  });
  const items = await Promise.all(page.items.map(async (saga) => toStatusResponse(saga, await listStepsForSaga(saga.saga_id))));
  return { items, total: page.total, limit: page.limit, offset: page.offset };
}
