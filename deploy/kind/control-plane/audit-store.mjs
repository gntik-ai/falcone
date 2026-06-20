// Action-audit store (domain B, kind deploy) — the WRITER side of the
// Observability audit-records surface (add-audit-write-and-scope-enforcement-store, #557).
//
// The live 2-tenant campaign found that after real control-plane actions (create
// users / workspaces / etc.) the audit-records query returned ZERO entries: nothing
// wrote an audit record, and the metrics audit handler returned a hardcoded empty
// page. This module records each mutating action into `plan_audit_events` (the table
// already created at boot in tenant-store.mjs, carrying a correlation_id column) and
// reads it back, TENANT-SCOPED, for the metrics audit-records handler.
//
// Isolation (cardinal rule, multitenant BaaS): every record carries tenant_id (and,
// when applicable, the owning workspace under new_state.workspaceId); reads are
// filtered by the path-resolved tenant (and workspace) so a tenant only ever sees its
// own action history. The metrics handler additionally guards cross-tenant access
// before calling in.
//
// plan_audit_events columns (see tenant-store.mjs::ensureSchema):
//   id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state,
//   correlation_id, created_at. We reuse it as the generic action-audit log: the
//   workspace id (when present) is carried in new_state.workspaceId so the workspace
//   read can filter without a schema change.

import { randomUUID } from 'node:crypto';
import { auditCanonical, computeRowHash } from './audit-hash.mjs';

// Record a single action-audit event. Best-effort by design: auditing must NEVER
// fail the action it describes, so callers wrap this and swallow errors.
//
// The row carries the TRUE `outcome` (succeeded/denied/failed/error) and is linked
// into a per-tenant append-only HASH CHAIN (#644): within one transaction holding a
// per-tenant advisory lock (to serialize concurrent audit writes for the tenant), we
// read the tenant's latest row_hash as prev_hash, generate id + created_at in-app so
// they are covered by the hash, compute row_hash, and INSERT atomically.
export async function recordAuditEvent(db, {
  actionType, actorId, tenantId = null, workspaceId = null, outcome = 'succeeded',
  previousState = null, newState = {}, correlationId = null
} = {}) {
  const merged = workspaceId ? { ...(newState ?? {}), workspaceId } : (newState ?? {});
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const at = String(actionType ?? 'action').slice(0, 64);
  const actor = String(actorId ?? 'unknown');
  const tid = tenantId ?? null;

  const usePooled = typeof db.connect === 'function';
  const client = usePooled ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    // Serialize per-tenant chain appends so two concurrent writes can't fork it.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::int8)', [`audit:${tid ?? 'global'}`]);
    const prev = await client.query(
      'SELECT row_hash FROM plan_audit_events WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
      [tid]
    );
    const prevHash = prev.rows[0]?.row_hash ?? '';
    const rowHash = computeRowHash(auditCanonical({ id, actionType: at, actorId: actor, tenantId: tid, outcome, createdAt, newState: merged }), prevHash);
    const res = await client.query(
      `INSERT INTO plan_audit_events (id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash)
       VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)
       RETURNING id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash`,
      [id, at, actor, tid, previousState == null ? null : JSON.stringify(previousState), JSON.stringify(merged ?? {}), outcome, correlationId ?? null, createdAt, prevHash, rowHash]
    );
    await client.query('COMMIT');
    return res.rows[0] ?? null;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    if (usePooled) client.release?.();
  }
}

// Read action-audit events for a scope, NEWEST first. Always filtered by tenant_id;
// when workspaceId is given, additionally filter to events whose new_state.workspaceId
// matches (workspace-scoped read). `tenantId` is required — never return cross-tenant.
export async function queryAuditEvents(db, { tenantId, workspaceId = null, limit = 50 } = {}) {
  if (!tenantId) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [tenantId];
  let where = 'tenant_id = $1';
  if (workspaceId) {
    params.push(workspaceId);
    where += ` AND workspace_id = $${params.length}`;
  }
  params.push(safeLimit);
  const sql = workspaceId
    // workspace id is carried in new_state.workspaceId (no dedicated column on the
    // shared table); expose it as a derived `workspace_id` for the filter.
    ? `SELECT id, action_type, actor_id, tenant_id, new_state->>'workspaceId' AS workspace_id,
              previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash
         FROM (SELECT *, new_state->>'workspaceId' AS workspace_id FROM plan_audit_events WHERE tenant_id = $1) e
         WHERE ${where}
         ORDER BY created_at DESC, id DESC LIMIT $${params.length}`
    : `SELECT id, action_type, actor_id, tenant_id, new_state->>'workspaceId' AS workspace_id,
              previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash
         FROM plan_audit_events
         WHERE ${where}
         ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
  const res = await db.query(sql, params);
  return res.rows ?? [];
}

// Map a plan_audit_events row -> the Observability audit-record shape the console
// audit-records page consumes (eventId/eventTimestamp/actor/scope/action/result/
// correlationId). Mirrors apps/control-plane/src/observability-audit-query.mjs's
// normalizeAuditRecord so the kind read is shape-compatible with the product.
export function auditRowToRecord(row = {}) {
  const newState = row.new_state ?? {};
  return {
    eventId: row.id,
    eventTimestamp: row.created_at,
    actor: { actorId: row.actor_id ?? null },
    scope: { tenantId: row.tenant_id ?? null, workspaceId: row.workspace_id ?? newState.workspaceId ?? null },
    resource: {},
    action: { actionId: row.action_type ?? null },
    actionType: row.action_type ?? null,
    // True outcome from the stored column (#644); legacy rows (NULL) read as 'unknown'.
    result: { outcome: row.outcome ?? 'unknown' },
    correlationId: row.correlation_id ?? null,
    origin: { originSurface: 'control_api' },
    // Tamper-evidence: expose the per-tenant hash-chain links so a client can verify.
    rowHash: row.row_hash ?? null,
    prevHash: row.prev_hash ?? null,
    detail: newState
  };
}
