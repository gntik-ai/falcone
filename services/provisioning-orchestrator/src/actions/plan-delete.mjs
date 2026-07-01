import { randomUUID } from 'node:crypto';
import * as planRepository from '../repositories/plan-repository.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';

const ERROR_STATUS_CODES = {
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  PLAN_NOT_FOUND: 404,
  PLAN_ACTIVE: 409,
  PLAN_HAS_ASSIGNMENT_HISTORY: 409
};

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

async function insertAudit(db, input) {
  await db.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      input.actionType,
      input.actorId,
      input.tenantId ?? null,
      input.planId ?? null,
      input.previousState ? JSON.stringify(input.previousState) : null,
      JSON.stringify(input.newState),
      input.correlationId
    ]
  );
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    if (!params.planId) throw Object.assign(new Error('planId is required'), { code: 'VALIDATION_ERROR' });

    const deleted = await planRepository.deleteNeverAssigned(db, params.planId);
    const correlationId = params.correlationId ?? randomUUID();
    const deletionState = { planId: deleted.id, deleted: true, deletedAt: new Date().toISOString() };
    await insertAudit(db, {
      actionType: 'plan.deleted',
      actorId: actor.id,
      planId: null,
      previousState: deleted,
      newState: deletionState,
      correlationId
    });
    await emitPlanEvent(producer, 'plan.deleted', {
      correlationId,
      actorId: actor.id,
      planId: deleted.id,
      previousState: deleted,
      newState: deletionState
    });
    return { statusCode: 200, body: { planId: deleted.id, deleted: true } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
