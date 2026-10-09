import { randomUUID } from 'node:crypto';
import { appendPlanAudit } from '../repositories/plan-audit-repository.mjs';
import { Plan } from '../models/plan.mjs';
import * as planRepository from '../repositories/plan-repository.mjs';
import * as catalogRepository from '../repositories/boolean-capability-catalog-repository.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';

const ERROR_STATUS_CODES = { INVALID_SLUG: 400, VALIDATION_ERROR: 400, INVALID_CAPABILITY_KEY: 400, PLAN_SLUG_CONFLICT: 409, FORBIDDEN: 403 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    const plan = new Plan({
      slug: params.slug,
      displayName: params.displayName,
      description: params.description ?? null,
      capabilities: params.capabilities ?? {},
      quotaDimensions: params.quotaDimensions ?? {},
      createdBy: actor.id,
      updatedBy: actor.id
    });
    if (Object.keys(plan.capabilities).length > 0) {
      await catalogRepository.validateCapabilityKeys(db, Object.keys(plan.capabilities));
    }
    const created = await planRepository.create(db, plan);
    const correlationId = params.correlationId ?? randomUUID();
    await appendPlanAudit(db, { actionType: 'plan.created', actorId: actor.id, planId: created.id, newState: created, correlationId });
    await emitPlanEvent(producer, 'plan.created', { correlationId, actorId: actor.id, planId: created.id, newState: created });
    return { statusCode: 201, body: created };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
