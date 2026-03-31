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
    const removed = await removeSubQuota({ tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey }, db);
    await emitSubQuotaRemoved({ tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, previousValue: removed.allocatedValue, actor: actor.id, timestamp: new Date().toISOString() }, producer);
    await insertAudit(db, { action_type: 'quota.sub_quota.removed', actor_id: actor.id, tenant_id: params.tenantId, previous_state: { workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, allocatedValue: removed.allocatedValue }, new_state: { removed: true }, correlation_id: params.correlationId ?? randomUUID() });
    return { statusCode: 200, body: { removed: true, tenantId: params.tenantId, workspaceId: params.workspaceId, dimensionKey: params.dimensionKey, previousValue: removed.allocatedValue } };
  } catch (error) {
    error.statusCode = error.statusCode ?? ERROR_STATUS_CODES[error.code] ?? 500;
    throw error;
  }
}
