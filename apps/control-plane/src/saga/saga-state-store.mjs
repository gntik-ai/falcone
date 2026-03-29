import { randomUUID } from 'node:crypto';

const ADAPTER_URL = new URL('../../../../services/adapters/src/postgresql-data-api.mjs', import.meta.url);
let adapterModulePromise;

function nowIso() {
  return new Date().toISOString();
}

async function loadAdapterModule() {
  if (!adapterModulePromise) {
    adapterModulePromise = import(ADAPTER_URL).catch(() => ({}));
  }
  return adapterModulePromise;
}

async function adapterQuery(sql, params = []) {
  const adapter = await loadAdapterModule();
  const candidate = adapter.query ?? adapter.executeQuery ?? adapter.execute ?? adapter.default?.query ?? adapter.default?.execute;
  if (!candidate) {
    return { rows: [] };
  }
  return candidate(sql, params);
}

/**
 * Snapshots stored here must exclude secrets and full credential values.
 */
export async function createSagaInstance(workflowId, params = {}, callerCtx = {}, correlationId, idempotencyKey = null) {
  const row = {
    saga_id: randomUUID(),
    workflow_id: workflowId,
    idempotency_key: idempotencyKey,
    correlation_id: correlationId,
    tenant_id: callerCtx.tenantId,
    workspace_id: callerCtx.workspaceId ?? null,
    actor_type: callerCtx.actorType ?? 'unknown',
    actor_id: callerCtx.actorId ?? callerCtx.actor ?? 'unknown',
    status: 'executing',
    recovery_policy: callerCtx.recoveryPolicy ?? 'compensate',
    input_snapshot: params,
    output_snapshot: null,
    error_summary: null,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  await adapterQuery(
    'INSERT INTO saga_instances (saga_id, workflow_id, idempotency_key, correlation_id, tenant_id, workspace_id, actor_type, actor_id, status, recovery_policy, input_snapshot, output_snapshot, error_summary, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
    [row.saga_id, row.workflow_id, row.idempotency_key, row.correlation_id, row.tenant_id, row.workspace_id, row.actor_type, row.actor_id, row.status, row.recovery_policy, row.input_snapshot, row.output_snapshot, row.error_summary, row.created_at, row.updated_at]
  );

  return row;
}

export async function updateSagaStatus(sagaId, status, outputOrError) {
  const isError = status === 'compensation-failed';
  await adapterQuery(
    'UPDATE saga_instances SET status = $2, output_snapshot = $3, error_summary = $4, updated_at = $5 WHERE saga_id = $1',
    [sagaId, status, isError ? null : outputOrError ?? null, isError ? outputOrError ?? null : null, nowIso()]
  );
}

export async function createSagaStep(sagaId, ordinal, key, input = {}) {
  const row = {
    step_id: randomUUID(),
    saga_id: sagaId,
    step_ordinal: ordinal,
    step_key: key,
    status: 'pending',
    input_snapshot: input,
    output_snapshot: null,
    error_detail: null,
    compensation_attempts: 0,
    created_at: nowIso(),
    updated_at: nowIso()
  };

  await adapterQuery(
    'INSERT INTO saga_steps (step_id, saga_id, step_ordinal, step_key, status, input_snapshot, output_snapshot, error_detail, compensation_attempts, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
    [row.step_id, row.saga_id, row.step_ordinal, row.step_key, row.status, row.input_snapshot, row.output_snapshot, row.error_detail, row.compensation_attempts, row.created_at, row.updated_at]
  );

  return row;
}

export async function updateStepStatus(stepId, status, outputOrError) {
  const isError = status === 'failed' || status === 'compensation-failed';
  await adapterQuery(
    'UPDATE saga_steps SET status = $2, output_snapshot = $3, error_detail = $4, updated_at = $5 WHERE step_id = $1',
    [stepId, status, isError ? null : outputOrError ?? null, isError ? outputOrError ?? null : null, nowIso()]
  );
}

export async function updateStepCompensationAttempts(stepId, attempts) {
  await adapterQuery('UPDATE saga_steps SET compensation_attempts = $2, updated_at = $3 WHERE step_id = $1', [stepId, attempts, nowIso()]);
}

export async function getInFlightSagas(stalenessMs) {
  const result = await adapterQuery(
    "SELECT * FROM saga_instances WHERE status IN ('executing','compensating') AND updated_at < $1",
    [new Date(Date.now() - stalenessMs).toISOString()]
  );
  return result.rows ?? [];
}

export async function getSagaById(sagaId) {
  const result = await adapterQuery('SELECT * FROM saga_instances WHERE saga_id = $1', [sagaId]);
  return result.rows?.[0] ?? null;
}

export async function listStepsForSaga(sagaId) {
  const result = await adapterQuery('SELECT * FROM saga_steps WHERE saga_id = $1 ORDER BY step_ordinal ASC', [sagaId]);
  return result.rows ?? [];
}

export async function appendCompensationLog(sagaId, stepId, attempt, outcome, errorDetail = null) {
  await adapterQuery(
    'INSERT INTO saga_compensation_log (log_id, saga_id, step_id, attempt, outcome, error_detail, executed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), sagaId, stepId, attempt, outcome, errorDetail, nowIso()]
  );
}

export async function findSagaByIdempotencyKey(key, tenantId) {
  const result = await adapterQuery('SELECT * FROM saga_instances WHERE idempotency_key = $1 AND tenant_id = $2', [key, tenantId]);
  return result.rows?.[0] ?? null;
}

export async function listSagasForTenantRecordset(tenantId, filters = {}) {
  const result = await adapterQuery('SELECT * FROM saga_instances WHERE tenant_id = $1', [tenantId]);
  let items = result.rows ?? [];
  if (filters.workflowId) items = items.filter((item) => item.workflow_id === filters.workflowId);
  if (filters.status) items = items.filter((item) => item.status === filters.status);
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 20;
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}
