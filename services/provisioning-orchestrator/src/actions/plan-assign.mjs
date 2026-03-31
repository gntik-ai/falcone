import { randomUUID } from 'node:crypto';
import * as planRepository from '../repositories/plan-repository.mjs';
import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';
import * as effectiveEntitlementsRepository from '../repositories/effective-entitlements-repository.mjs';
import * as tenantUsageSnapshotRepository from '../repositories/tenant-usage-snapshot-repository.mjs';
import { buildCapabilityImpactSet, buildQuotaImpactSet, determineChangeDirection, summarizeUsageCollectionStatus } from '../models/effective-entitlement-snapshot.mjs';
import { emitPlanEvent } from '../events/plan-events.mjs';
import { emitChangeImpactRecorded } from '../events/plan-change-impact-events.mjs';
import { buildChangeImpactLogFields, plan_change_history_event_publish_total, plan_change_history_over_limit_dimensions_total, plan_change_history_write_duration_ms, plan_change_history_write_total, recordMetric } from '../observability/plan-change-impact-metrics.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, VALIDATION_ERROR: 400, PLAN_NOT_FOUND: 404, PLAN_NOT_ACTIVE: 409, CONCURRENT_ASSIGNMENT_CONFLICT: 409, TENANT_NOT_FOUND: 404 };

function requireSuperadmin(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id || actor.type !== 'superadmin') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  return actor;
}

async function ensureTenantExists(db, tenantId) {
  if (!tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'VALIDATION_ERROR' });
  try {
    const { rows } = await db.query('SELECT 1 AS present FROM tenants WHERE id = $1 OR tenant_id = $1 LIMIT 1', [tenantId]);
    if (!rows.length) throw Object.assign(new Error('Tenant not found'), { code: 'TENANT_NOT_FOUND' });
  } catch (error) {
    if (error.code === '42P01') return true;
    throw error;
  }
  return true;
}

async function insertAudit(db, input) {
  await db.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [input.actionType, input.actorId, input.tenantId ?? null, input.planId ?? null, input.previousState ? JSON.stringify(input.previousState) : null, JSON.stringify(input.newState), input.correlationId]
  );
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  const metricRecorder = overrides.metricRecorder ?? params.metricRecorder;
  const logger = overrides.logger ?? console;
  const startedAt = Date.now();
  try {
    const actor = requireSuperadmin(params);
    if (!params.planId || !params.tenantId || !params.assignedBy) throw Object.assign(new Error('tenantId, planId, assignedBy are required'), { code: 'VALIDATION_ERROR' });
    await ensureTenantExists(db, params.tenantId);
    const plan = await planRepository.findById(db, params.planId);
    if (!plan) throw Object.assign(new Error('Plan not found'), { code: 'PLAN_NOT_FOUND' });
    if (plan.status !== 'active') throw Object.assign(new Error('Plan is not active'), { code: 'PLAN_NOT_ACTIVE' });
    const currentAssignment = await assignmentRepository.getCurrent(db, params.tenantId);
    const previousEntitlements = currentAssignment
      ? await effectiveEntitlementsRepository.resolveEffectiveEntitlements(db, params.tenantId, currentAssignment.planId)
      : { quotaDimensions: [], capabilities: [] };
    const nextEntitlements = await effectiveEntitlementsRepository.resolveEffectiveEntitlements(db, params.tenantId, params.planId);
    const usageSnapshot = await tenantUsageSnapshotRepository.collectObservedUsage(
      params.tenantId,
      nextEntitlements.quotaDimensions.map((item) => item.dimensionKey),
      { client: db, collectors: overrides.usageCollectors ?? params.usageCollectors }
    );
    const quotaImpacts = buildQuotaImpactSet(previousEntitlements.quotaDimensions, nextEntitlements.quotaDimensions, usageSnapshot);
    const capabilityImpacts = buildCapabilityImpactSet(previousEntitlements.capabilities, nextEntitlements.capabilities);
    const overLimitDimensionCount = quotaImpacts.filter((item) => item.usageStatus === 'over_limit').length;
    const changeDirection = determineChangeDirection(previousEntitlements.quotaDimensions, nextEntitlements.quotaDimensions, currentAssignment?.planId ?? null, params.planId);
    const usageCollectionStatus = summarizeUsageCollectionStatus(usageSnapshot);
    const correlationId = params.correlationId ?? randomUUID();
    const result = await assignmentRepository.insertWithHistory(db, { tenantId: params.tenantId, planId: params.planId, assignedBy: params.assignedBy, assignmentMetadata: params.assignmentMetadata ?? {} }, {
      previousPlanId: currentAssignment?.planId ?? null,
      actorId: actor.id,
      correlationId,
      changeReason: params.changeReason ?? params.assignmentMetadata?.reason ?? null,
      changeDirection,
      usageCollectionStatus,
      overLimitDimensionCount,
      quotaImpacts,
      capabilityImpacts
    });
    if (result.previousPlanId) {
      await insertAudit(db, { actionType: 'assignment.superseded', actorId: actor.id, tenantId: params.tenantId, planId: result.previousPlanId, previousState: { tenantId: params.tenantId, planId: result.previousPlanId }, newState: { tenantId: params.tenantId, supersededByPlanId: params.planId }, correlationId });
      await emitPlanEvent(producer, 'assignment.superseded', { correlationId, actorId: actor.id, tenantId: params.tenantId, planId: result.previousPlanId, previousState: { tenantId: params.tenantId, planId: result.previousPlanId }, newState: { tenantId: params.tenantId, supersededByPlanId: params.planId } });
    }
    await insertAudit(db, { actionType: 'assignment.created', actorId: actor.id, tenantId: params.tenantId, planId: params.planId, previousState: result.previousPlanId ? { tenantId: params.tenantId, planId: result.previousPlanId } : null, newState: result.assignment, correlationId });
    await insertAudit(db, { actionType: 'plan.change_impact_recorded', actorId: actor.id, tenantId: params.tenantId, planId: params.planId, previousState: result.previousPlanId ? { tenantId: params.tenantId, planId: result.previousPlanId } : null, newState: { historyEntryId: result.historyEntry?.historyEntryId, correlationId, changeDirection, overLimitDimensionCount }, correlationId });
    await emitPlanEvent(producer, 'assignment.created', { correlationId, actorId: actor.id, tenantId: params.tenantId, planId: params.planId, previousState: result.previousPlanId ? { tenantId: params.tenantId, planId: result.previousPlanId } : null, newState: result.assignment });
    await emitChangeImpactRecorded(producer, { ...result.historyEntry, planAssignmentId: result.assignment.assignmentId });
    recordMetric(metricRecorder, plan_change_history_write_total, 1, { result: 'success' });
    recordMetric(metricRecorder, plan_change_history_write_duration_ms, Date.now() - startedAt, {});
    if (overLimitDimensionCount > 0) recordMetric(metricRecorder, plan_change_history_over_limit_dimensions_total, overLimitDimensionCount, {});
    recordMetric(metricRecorder, plan_change_history_event_publish_total, 1, { result: 'success' });
    logger.info?.('plan change impact recorded', buildChangeImpactLogFields({ ...result.historyEntry, planAssignmentId: result.assignment.assignmentId }));
    return { statusCode: 200, body: { assignmentId: result.assignment.assignmentId, tenantId: result.assignment.tenantId, planId: result.assignment.planId, effectiveFrom: result.assignment.effectiveFrom, previousPlanId: result.previousPlanId, historyEntryId: result.historyEntry?.historyEntryId ?? null, changeDirection, overLimitDimensionCount, usageCollectionStatus } };
  } catch (error) {
    if (error?.historyEntryId) recordMetric(metricRecorder, plan_change_history_event_publish_total, 1, { result: 'failure' });
    recordMetric(metricRecorder, plan_change_history_write_total, 1, { result: 'failure' });
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
