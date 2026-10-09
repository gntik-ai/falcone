import { recordAuditEvent, recordAuditEventInTransaction } from '../../../../apps/control-plane/audit-store.mjs';

// Retain the existing in-memory persistence boundary while using the same hashed
// append implementation as PostgreSQL. Serialize it too, so concurrent actions
// cannot select the same predecessor.
const memoryAppends = new WeakMap();
function memoryClient(rows) {
  return { async query(sql, params = []) {
    if (sql.includes('SELECT row_hash')) {
      const head = rows.filter((row) => row.tenant_id === params[0] && row.row_hash != null).at(-1);
      return { rows: head ? [head] : [] };
    }
    if (sql.includes('INSERT INTO plan_audit_events')) {
      const [id, action_type, actor_id, tenant_id, previous, next, outcome, correlation_id, created_at, prev_hash, row_hash, plan_id] = params;
      const row = { id, action_type, actor_id, tenant_id, plan_id, previous_state: previous == null ? null : JSON.parse(previous), new_state: JSON.parse(next), outcome, correlation_id, created_at, prev_hash, row_hash };
      rows.push(row);
      return { rows: [row] };
    }
    return { rows: [] };
  } };
}

export async function appendPlanAudit(db, input, { inTransaction = false } = {}) {
  const event = {
    actionType: input.actionType ?? input.action_type,
    actorId: input.actorId ?? input.actor_id,
    tenantId: input.tenantId ?? input.tenant_id ?? null,
    planId: input.planId ?? input.plan_id ?? null,
    previousState: input.previousState ?? input.previous_state ?? null,
    newState: input.newState ?? input.new_state ?? {},
    correlationId: input.correlationId ?? input.correlation_id ?? null,
  };
  if (db._planAuditEvents !== undefined) {
    const append = (memoryAppends.get(db) ?? Promise.resolve()).then(() => recordAuditEvent(memoryClient(db._planAuditEvents), event));
    memoryAppends.set(db, append.catch(() => {}));
    return append;
  }
  return inTransaction ? recordAuditEventInTransaction(db, event) : recordAuditEvent(db, event);
}
