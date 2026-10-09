import { appendPlanAudit } from '../repositories/plan-audit-repository.mjs';
import { randomUUID } from 'node:crypto';
import { removeSubQuota } from '../repositories/workspace-sub-quota-repository.mjs';
import { emitSubQuotaRemoved } from '../events/workspace-sub-quota-events.mjs';

const ERROR_STATUS_CODES = { FORBIDDEN: 403, SUB_QUOTA_NOT_FOUND: 404 };

function authorize(params) {
  const actor = params.callerContext?.actor;
  if (!actor?.id) throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
  if (actor.type === 'superadmin' || actor.type === 'internal') return actor;
  if ((actor.type === 'tenant_owner' || actor.type === 'tenant-owner' || actor.type === 'tenant') && (actor.tenantId ?? params.tenantId) === params.tenantId) return actor;
  if ((actor.type === 'workspace_admin' || actor.type === 'workspace-admin') && (actor.tenantId ?? params.tenantId) === params.tenantId && (actor.workspaceId ?? actor.workspace?.id) === params.workspaceId) return actor;
  throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN' });
}

export async function main(params = {}, overrides = {}) {
  const db = overrides.db ?? params.db;
  const producer = overrides.producer ?? params.producer;
  try {
    const actor = authorize(params);
    const removed = await removeSubQuota({ tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey }, db);
    await emitSubQuotaRemoved({ tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, previousValue: removed.allocatedValue, actor: actor.id, timestamp: new Date().toISOString() }, producer);
    await appendPlanAudit(db, { action_type: 'quota.sub_quota.removed', actor_id: actor.id, tenant_id: params.tenantId, previous_state: { workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, allocatedValue: removed.allocatedValue }, new_state: { removed: true }, correlation_id: params.correlationId ?? randomUUID() });
    return { statusCode: 200, body: { removed: true, tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, previousValue: removed.allocatedValue } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
