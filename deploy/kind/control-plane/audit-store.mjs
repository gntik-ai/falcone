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

// Record a single action-audit event. Best-effort by design: auditing must NEVER
// fail the action it describes, so callers wrap this and swallow errors.
export async function recordAuditEvent(db, {
  actionType, actorId, tenantId = null, workspaceId = null,
  previousState = null, newState = {}, correlationId = null
} = {}) {
  const merged = workspaceId ? { ...(newState ?? {}), workspaceId } : (newState ?? {});
  const res = await db.query(
    `INSERT INTO plan_audit_events (action_type, actor_id, tenant_id, plan_id, previous_state, new_state, correlation_id)
     VALUES ($1,$2,$3,NULL,$4::jsonb,$5::jsonb,$6)
     RETURNING id, action_type, actor_id, tenant_id, previous_state, new_state, correlation_id, created_at`,
    [
      String(actionType ?? 'action').slice(0, 64),
      String(actorId ?? 'unknown'),
      tenantId ?? null,
      previousState == null ? null : JSON.stringify(previousState),
      JSON.stringify(merged ?? {}),
      correlationId ?? null
    ]
  );
  return res.rows[0] ?? null;
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
              previous_state, new_state, correlation_id, created_at
         FROM (SELECT *, new_state->>'workspaceId' AS workspace_id FROM plan_audit_events WHERE tenant_id = $1) e
         WHERE ${where}
         ORDER BY created_at DESC, id DESC LIMIT $${params.length}`
    : `SELECT id, action_type, actor_id, tenant_id, new_state->>'workspaceId' AS workspace_id,
              previous_state, new_state, correlation_id, created_at
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
    result: { outcome: 'succeeded' },
    correlationId: row.correlation_id ?? null,
    origin: { originSurface: 'control_api' },
    detail: newState
  };
}
