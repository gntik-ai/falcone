import { appendPlanAudit } from '../repositories/plan-audit-repository.mjs';
import { randomUUID } from 'node:crypto';
import * as planRepository from '../repositories/plan-repository.mjs';
import * as catalogRepository from '../repositories/boolean-capability-catalog-repository.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';
import { emitCapabilityEvents } from '../events/plan-capability-events.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400, INVALID_CAPABILITY_KEY: 400, PLAN_NOT_FOUND: 404, PLAN_ARCHIVED: 409 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

function diffCapabilities(previous = {}, current = {}) {
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(current ?? {})]);
  return [...keys].sort().flatMap((capabilityKey) => {
    const hadPrevious = Object.prototype.hasOwnProperty.call(previous ?? {}, capabilityKey);
    const hasCurrent = Object.prototype.hasOwnProperty.call(current ?? {}, capabilityKey);
    const previousState = hadPrevious ? Boolean(previous[capabilityKey]) : null;
    const currentState = hasCurrent ? Boolean(current[capabilityKey]) : null;
    if (hadPrevious && hasCurrent && previousState === currentState) return [];
    return [{ capabilityKey, previousState, newState: currentState }];
  });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = requireSuperadmin(params);
    const updates = {
      displayName: params.displayName,
      description: params.description,
      capabilities: params.capabilities,
      quotaDimensions: params.quotaDimensions,
      updatedBy: actor.id
    };
    if (Object.values(updates).slice(0, 4).every((value) => value === undefined)) throw Object.assign(new Error('No updates provided'), { code: 'VALIDATION_ERROR' });
    if (updates.capabilities && Object.keys(updates.capabilities).length > 0) {
      await catalogRepository.validateCapabilityKeys(db, Object.keys(updates.capabilities));
    }
    const result = await planRepository.update(db, params.planId, updates);
    const correlationId = params.correlationId ?? randomUUID();
    await appendPlanAudit(db, { actionType: 'plan.updated', actorId: actor.id, planId: params.planId, previousState: result.previous, newState: result.current, correlationId });
    const capabilityChanges = updates.capabilities ? diffCapabilities(result.previous?.capabilities ?? {}, result.current?.capabilities ?? {}) : [];
    if (capabilityChanges.length > 0) {
      const catalog = await catalogRepository.listActiveCatalog(db);
      const labelMap = new Map(catalog.map((entry) => [entry.capabilityKey, entry.displayLabel]));
      for (const change of capabilityChanges) {
        await appendPlanAudit(db, {
          actionType: change.newState ? 'plan.capability.enabled' : 'plan.capability.disabled',
          actorId: actor.id,
          planId: params.planId,
          previousState: { capabilityKey: change.capabilityKey, previousState: change.previousState },
          newState: { capabilityKey: change.capabilityKey, newState: change.newState },
          correlationId
        });
      }
      await emitCapabilityEvents(producer, {
        planId: params.planId,
        planSlug: result.current?.slug ?? null,
        changedItems: capabilityChanges.map((entry) => ({ ...entry, displayLabel: labelMap.get(entry.capabilityKey) ?? entry.capabilityKey })),
        actorId: actor.id,
        correlationId
      });
    }
    await emitPlanEvent(producer, 'plan.updated', { correlationId, actorId: actor.id, planId: params.planId, previousState: result.previous, newState: result.current });
    return { statusCode: 200, body: result.current };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
