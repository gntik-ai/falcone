// Tamper-evidence for the action-audit log (#644).
//
// Each audit row is linked to its per-tenant predecessor by a hash chain:
//   row_hash = SHA-256( canonical(row) || prev_hash )
// where prev_hash is the previous row's row_hash for the same tenant (genesis '').
// Altering any hashed field, or deleting/reordering a row, breaks the chain — so
// the log is append-only / tamper-evident and a tenant can verify its own slice.
//
// These helpers are PURE (no I/O) and used on both sides: the writer
// (audit-store.recordAuditEvent) computes the hash; verifyAuditChain re-derives it.
import { createHash } from 'node:crypto';

// Deterministic JSON: object keys sorted recursively, so the canonical form is
// independent of key order. This matters because JSONB does NOT preserve key
// order across a DB round-trip — a naive JSON.stringify would not re-derive.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function isoOrNull(ts) {
  if (ts == null || ts === '') return null;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString();
}

/**
 * Canonical string for the hashed fields of an audit row. Accepts both the
 * camelCase writer input and a snake_case DB row, and normalizes created_at to an
 * ISO string (Date vs string round-trip) so the hash re-derives after a read.
 */
export function auditCanonical(fields = {}) {
  return stableStringify({
    id: fields.id ?? null,
    action_type: fields.actionType ?? fields.action_type ?? null,
    actor_id: fields.actorId ?? fields.actor_id ?? null,
    tenant_id: fields.tenantId ?? fields.tenant_id ?? null,
    outcome: fields.outcome ?? null,
    created_at: isoOrNull(fields.createdAt ?? fields.created_at),
    new_state: fields.newState ?? fields.new_state ?? {},
  });
}

/** row_hash = SHA-256(canonical || '\n' || prevHash) in hex. */
export function computeRowHash(canonical, prevHash = '') {
  return createHash('sha256').update(String(canonical) + '\n' + (prevHash ?? '')).digest('hex');
}

const rh = (row) => row.row_hash ?? row.rowHash ?? '';
const ph = (row) => row.prev_hash ?? row.prevHash ?? '';

/**
 * Verify a per-tenant chain of audit rows in ASCENDING (oldest-first) order.
 * Checks each row's prev_hash links to the previous row's row_hash (genesis '')
 * AND that row_hash re-derives from the row's content. Returns the index of the
 * first broken row, or { valid: true, brokenAt: null }.
 */
export function verifyAuditChain(rowsAscending = []) {
  let expectedPrev = '';
  for (let i = 0; i < rowsAscending.length; i++) {
    const row = rowsAscending[i];
    if (ph(row) !== expectedPrev) return { valid: false, brokenAt: i };
    const expectedHash = computeRowHash(auditCanonical(row), ph(row));
    if (expectedHash !== rh(row)) return { valid: false, brokenAt: i };
    expectedPrev = rh(row);
  }
  return { valid: true, brokenAt: null };
}
