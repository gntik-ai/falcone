import { normalizeEffectiveLimit } from '../models/quota-enforcement.mjs';
import { normalizeQuotaTypeEntry } from '../models/quota-dimension.mjs';
import { getActiveOverrideByTenantAndDimension } from './quota-override-repository.mjs';
import { listAllDimensions } from './quota-dimension-catalog-repository.mjs';
import { getLimitsByTenantCurrentPlan } from './plan-limits-repository.mjs';

function ensureStores(db) { db._quotaEnforcementLog ??= []; return db; }

export async function resolveEffectiveLimit(db, tenantId, dimensionKey) {
  const assignment = await getLimitsByTenantCurrentPlan(db, tenantId);
  const dimensions = await listAllDimensions(db);
  const dimension = dimensions.find((item) => item.dimensionKey === dimensionKey);
  if (!dimension) throw Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });
  const override = await getActiveOverrideByTenantAndDimension(db, tenantId, dimensionKey);
  if (override) return normalizeEffectiveLimit({ dimensionKey, displayLabel: dimension.displayLabel, unit: dimension.unit, effectiveValue: override.overrideValue, source: 'override', quotaType: override.quotaType, graceMargin: override.graceMargin, overrideMetadata: { overrideId: override.overrideId, expiresAt: override.expiresAt, justification: override.justification } });
  const explicitValue = assignment?.quotaDimensions && Object.prototype.hasOwnProperty.call(assignment.quotaDimensions, dimensionKey) ? assignment.quotaDimensions[dimensionKey] : null;
  const explicitType = normalizeQuotaTypeEntry(assignment?.quotaTypeConfig?.[dimensionKey] ?? null);
  return normalizeEffectiveLimit({ dimensionKey, displayLabel: dimension.displayLabel, unit: dimension.unit, effectiveValue: explicitValue ?? dimension.defaultValue, source: explicitValue === null ? 'default' : 'plan', quotaType: explicitType.type, graceMargin: explicitType.graceMargin, overrideMetadata: null, planSlug: assignment?.planSlug ?? null, planStatus: assignment?.planStatus ?? null });
}

export async function resolveEffectiveLimitsForTenant(db, tenantId) {
  const assignment = await getLimitsByTenantCurrentPlan(db, tenantId);
  if (!assignment) return { tenantId, noAssignment: true, effectiveLimits: [] };
  const dimensions = await listAllDimensions(db);
  const effectiveLimits = [];
  for (const dimension of dimensions) effectiveLimits.push(await resolveEffectiveLimit(db, tenantId, dimension.dimensionKey));
  return { tenantId, planSlug: assignment.planSlug, planStatus: assignment.planStatus, effectiveLimits };
}

export async function insertEnforcementLog(db, record) {
  ensureStores(db);
  db._quotaEnforcementLog.push({ id: `enf-${db._quotaEnforcementLog.length + 1}`, createdAt: new Date().toISOString(), ...record });
  return db._quotaEnforcementLog.at(-1);
}

export async function queryEnforcementLog(db, filters = {}) {
  ensureStores(db);
  return db._quotaEnforcementLog.filter((item) => (!filters.tenantId || item.tenantId === filters.tenantId) && (!filters.dimensionKey || item.dimensionKey === filters.dimensionKey) && (!filters.actorId || item.actorId === filters.actorId));
}
