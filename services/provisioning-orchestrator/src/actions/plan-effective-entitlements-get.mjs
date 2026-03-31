import * as assignmentRepository from '../repositories/plan-assignment-repository.mjs';
import * as effectiveEntitlementsRepository from '../repositories/effective-entitlements-repository.mjs';
import * as tenantUsageSnapshotRepository from '../repositories/tenant-usage-snapshot-repository.mjs';
import { classifyUsageStatus } from '../models/effective-entitlement-snapshot.mjs';

function resolveTenantId(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', statusCode: 403 });
  if (actor.type === 'superadmin' || actor.type === 'internal') {
    if (!params.tenantId) throw Object.assign(new Error('tenantId is required'), { code: 'VALIDATION_ERROR', statusCode: 400 });
    return params.tenantId;
  }
  const actorTenantId = actor.tenantId ?? actor.tenant?.id ?? params.tenantId;
  if (!actorTenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', statusCode: 403 });
  if (params.tenantId && params.tenantId !== actorTenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', statusCode: 403 });
  return actorTenantId;
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const tenantId = resolveTenantId(params);
  const assignment = await assignmentRepository.getCurrent(db, tenantId);
  if (!assignment) return { statusCode: 200, body: { tenantId, noAssignment: true, quotaDimensions: [], capabilities: [] } };
  const entitlements = await effectiveEntitlementsRepository.resolveEffectiveEntitlements(db, tenantId, assignment.planId);
  const usages = await tenantUsageSnapshotRepository.collectObservedUsage(tenantId, entitlements.quotaDimensions.map((item) => item.dimensionKey), { client: db, collectors: overrides.usageCollectors ?? params.usageCollectors });
  const usageMap = new Map(usages.map((item) => [item.dimensionKey, item]));
  let latest = null;
  try {
    const { items } = await (await import('../repositories/plan-change-history-repository.mjs')).queryHistoryByTenant(db, tenantId, { page: 1, pageSize: 1 });
    latest = items[0] ?? null;
  } catch {}
  const quotaDimensions = entitlements.quotaDimensions.map((item) => {
    const usage = usageMap.get(item.dimensionKey) ?? { status: 'unknown', reasonCode: 'usage_not_collected' };
    return {
      ...item,
      observedUsage: usage.status === 'unknown' ? null : usage.observedUsage ?? null,
      usageStatus: usage.status === 'unknown' ? 'unknown' : classifyUsageStatus({ newEffectiveValueKind: item.effectiveValueKind, newEffectiveValue: item.effectiveValue, observedUsage: usage.observedUsage }),
      usageUnknownReason: usage.status === 'unknown' ? usage.reasonCode ?? 'usage_not_collected' : null
    };
  });
  return {
    statusCode: 200,
    body: {
      tenantId,
      planId: entitlements.planId,
      planSlug: entitlements.planSlug,
      planDisplayName: entitlements.planDisplayName,
      effectiveFrom: assignment.effectiveFrom,
      latestHistoryEntryId: latest?.historyEntryId ?? null,
      latestPlanChangeAt: latest?.effectiveAt ?? null,
      quotaDimensions,
      capabilities: entitlements.capabilities
    }
  };
}
