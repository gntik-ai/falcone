import { validateImpactKinds } from './effective-entitlement-snapshot.mjs';

const CHANGE_DIRECTIONS = new Set(['upgrade', 'downgrade', 'lateral', 'equivalent', 'initial_assignment']);
const USAGE_COLLECTION_STATUSES = new Set(['complete', 'partial', 'unavailable']);

function requiredString(value, fieldName) {
  if (!value || typeof value !== 'string') throw new Error(`${fieldName} is required`);
  return value;
}

function normalizeArray(items) {
  return Array.isArray(items) ? items : [];
}

export class PlanChangeHistoryEntry {
  constructor(input = {}) {
    this.historyEntryId = input.historyEntryId ?? null;
    this.planAssignmentId = requiredString(input.planAssignmentId, 'planAssignmentId');
    this.tenantId = requiredString(input.tenantId, 'tenantId');
    this.previousPlanId = input.previousPlanId ?? null;
    this.newPlanId = requiredString(input.newPlanId, 'newPlanId');
    this.actorId = requiredString(input.actorId, 'actorId');
    this.effectiveAt = input.effectiveAt ?? new Date().toISOString();
    this.correlationId = input.correlationId ?? null;
    this.changeReason = input.changeReason ?? null;
    this.changeDirection = input.changeDirection ?? 'equivalent';
    this.usageCollectionStatus = input.usageCollectionStatus ?? 'unavailable';
    this.overLimitDimensionCount = Number.isInteger(input.overLimitDimensionCount) ? input.overLimitDimensionCount : 0;
    this.assignmentMetadata = input.assignmentMetadata ?? {};
    this.quotaImpacts = normalizeArray(input.quotaImpacts);
    this.capabilityImpacts = normalizeArray(input.capabilityImpacts);
    this.validate();
  }

  validate() {
    if (!CHANGE_DIRECTIONS.has(this.changeDirection)) throw new Error(`Unsupported changeDirection: ${this.changeDirection}`);
    if (!USAGE_COLLECTION_STATUSES.has(this.usageCollectionStatus)) throw new Error(`Unsupported usageCollectionStatus: ${this.usageCollectionStatus}`);
    this.quotaImpacts.forEach(validateImpactKinds);
    this.capabilityImpacts.forEach(validateImpactKinds);
    return true;
  }

  toRecord() {
    return {
      id: this.historyEntryId,
      plan_assignment_id: this.planAssignmentId,
      tenant_id: this.tenantId,
      previous_plan_id: this.previousPlanId,
      new_plan_id: this.newPlanId,
      actor_id: this.actorId,
      effective_at: this.effectiveAt,
      correlation_id: this.correlationId,
      change_reason: this.changeReason,
      change_direction: this.changeDirection,
      usage_collection_status: this.usageCollectionStatus,
      over_limit_dimension_count: this.overLimitDimensionCount,
      assignment_metadata: this.assignmentMetadata
    };
  }

  serialize() {
    return {
      historyEntryId: this.historyEntryId,
      planAssignmentId: this.planAssignmentId,
      tenantId: this.tenantId,
      previousPlanId: this.previousPlanId,
      newPlanId: this.newPlanId,
      actorId: this.actorId,
      effectiveAt: this.effectiveAt,
      correlationId: this.correlationId,
      changeReason: this.changeReason,
      changeDirection: this.changeDirection,
      usageCollectionStatus: this.usageCollectionStatus,
      overLimitDimensionCount: this.overLimitDimensionCount,
      assignmentMetadata: this.assignmentMetadata,
      quotaImpacts: this.quotaImpacts,
      capabilityImpacts: this.capabilityImpacts
    };
  }
}

export function createPlanChangeHistoryEntry(input) {
  return new PlanChangeHistoryEntry(input);
}
