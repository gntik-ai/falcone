import { findSagaByIdempotencyKey, updateSagaStatus } from './saga-state-store.mjs';

export async function checkIdempotencyKey(key, tenantId) {
  if (!key) return null;
  const row = await findSagaByIdempotencyKey(key, tenantId);
  if (!row) return null;
  if (row.status === 'completed') {
    return { sagaId: row.saga_id, status: 'completed', result: row.output_snapshot };
  }
  if (row.status === 'executing') {
    return { sagaId: row.saga_id, status: 'in-progress' };
  }
  return { sagaId: row.saga_id, status: row.status };
}

export async function recordIdempotencyResult(key, tenantId, sagaId, result) {
  if (!key) return;
  await updateSagaStatus(sagaId, 'completed', result);
}
