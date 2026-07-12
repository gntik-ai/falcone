import { randomUUID } from 'node:crypto';
import { validateSubQuotaValue } from '../models/workspace-sub-quota.mjs';
import { dimensionKeyExists } from '../repositories/quota-dimension-catalog-repository.mjs';
import { resolveUnifiedEntitlements } from '../repositories/effective-entitlements-repository.mjs';
import { upsertSubQuota } from '../repositories/workspace-sub-quota-repository.mjs';
import { emitSubQuotaSet } from '../events/workspace-sub-quota-events.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, INVALID_SUB_QUOTA_VALUE: 400, DIMENSION_NOT_FOUND: 404, SUB_QUOTA_EXCEEDS_TENANT_LIMIT: 422, LOCK_TIMEOUT: 503 };

function authorize(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') return actor;
  if (actor.type === 'tenant_owner' || actor.type === 'tenant-owner' || actor.type === 'tenant') {
    if ((actor.tenantId ?? params.tenantId) !== params.tenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
    return actor;
  }
  if (actor.type === 'workspace_admin' || actor.type === 'workspace-admin') {
    if ((actor.tenantId ?? params.tenantId) !== params.tenantId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
    if ((actor.workspaceId ?? actor.workspace?.id) !== params.workspaceId) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
    return actor;
  }
  throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

async function insertAudit(db, event) {
  if (db._planAuditEvents !== undefined) {
    db._planAuditEvents.push({ id: randomUUID(), created_at: new Date().toISOString(), ...event });
    return;
  }
  await db.query(`INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [event.action_type, event.actor_id, event.tenant_id, null, JSON.stringify(event.previous_state ?? null), JSON.stringify(event.new_state ?? {}), event.correlation_id ?? null]);
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = authorize(params);
    validateSubQuotaValue(params.allocatedValue);
    if (!(await dimensionKeyExists(db, params.dimensionKey))) throw Object.assign(new Error('Dimension not found'), { code: 'DIMENSION_NOT_FOUND' });
    const profile = await resolveUnifiedEntitlements({ tenantId: params.tenantId }, db);
    const dimension = profile.quantitativeLimits.find((entry) => entry.dimensionKey === params.dimensionKey);
    if (!dimension) throw Object.assign(new Error('Dimension not found'), { code: 'DIMENSION_NOT_FOUND' });
    const result = await upsertSubQuota({ tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, allocatedValue: params.allocatedValue, actorId: actor.id }, dimension.effectiveValue, db);
    if (result.previousValue === params.allocatedValue) {
      return { statusCode: 200, body: { subQuotaId: result.subQuota.id, tenantId: result.subQuota.tenantId, workspaceId: result.subQuota.workspaceId, dimensionKey: result.subQuota.dimensionKey, allocatedValue: result.subQuota.allocatedValue, changed: false, createdBy: result.subQuota.createdBy, updatedBy: result.subQuota.updatedBy, createdAt: result.subQuota.createdAt, updatedAt: result.subQuota.updatedAt } };
    }
    const correlationId = params.correlationId ?? randomUUID();
    await emitSubQuotaSet({ tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, previousValue: result.previousValue, newValue: params.allocatedValue, actor: actor.id, timestamp: new Date().toISOString() }, producer);
    await insertAudit(db, { action_type: 'quota.sub_quota.set', actor_id: actor.id, tenant_id: params.tenantId, previous_state: result.previousValue === null ? null : { allocatedValue: result.previousValue }, new_state: { workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, allocatedValue: params.allocatedValue }, correlation_id: correlationId });
    return { statusCode: result.isNew ? 201 : 200, body: { subQuotaId: result.subQuota.id, tenantId: result.subQuota.tenantId, workspaceId: result.subQuota.workspaceId, dimensionKey: result.subQuota.dimensionKey, allocatedValue: result.subQuota.allocatedValue, changed: true, createdBy: result.subQuota.createdBy, updatedBy: result.subQuota.updatedBy, createdAt: result.subQuota.createdAt, updatedAt: result.subQuota.updatedAt } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
