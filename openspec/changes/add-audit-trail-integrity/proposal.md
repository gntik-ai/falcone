## Why

The kind control-plane audit trail (`GET /v1/metrics/tenants/{id}/audit-records`) only records successful mutating actions and hardcodes `outcome = 'succeeded'` at read time — so FAILED and DENIED actions leave no record, secret-access operations are silently excluded, and the append-only log has no tamper-evidence. These gaps make the audit trail unreliable as a security record and non-verifiable by tenants. Resolves GitHub issue #644.

## What Changes

- **Add `outcome` column** to `plan_audit_events`: derive `succeeded`/`denied`/`failed`/`error` at WRITE time from `result.statusCode`; read it from the DB (remove the hardcoded constant in `auditRowToRecord`).
- **Record failures and denials**: remove the `status >= 400` short-circuit in `audit-writer.mjs::auditEventForRoute` so every auditable action is recorded regardless of HTTP outcome; `outcome` distinguishes result (the separate `scope_enforcement_denials` write is unchanged).
- **Audit secret-access**: add `secretSet`, `secretGet`, `secretList`, `secretDelete` to `AUDITABLE_LOCAL_HANDLERS` so secret reads/writes produce tenant-scoped audit records.
- **Tamper-evident hash chain**: add `prev_hash` and `row_hash` columns; `recordAuditEvent` runs inside a transaction holding `pg_advisory_xact_lock` per tenant, computes a SHA-256 chain linking each new row to the previous one; expose `rowHash`/`prevHash` in the read shape; ship a new pure-function module `audit-hash.mjs` with `auditCanonical`, `computeRowHash`, and `verifyAuditChain`.
- Schema migration is idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in `ensureSchema` (kind boot, no separate migration step).

## Capabilities

### New Capabilities

_(none — all changes extend the existing `audit` capability)_

### Modified Capabilities

- `audit`: ADD requirements for true outcome recording, failure/denial auditing, secret-access auditing, and per-tenant tamper-evident hash chain

## Impact

- `deploy/kind/control-plane/audit-store.mjs` — `recordAuditEvent` (hash chain + outcome write), `auditRowToRecord` (read `outcome`/`rowHash`/`prevHash` from DB row)
- `deploy/kind/control-plane/audit-writer.mjs` — `auditEventForRoute` (remove 400+ short-circuit + outcome derivation), `AUDITABLE_LOCAL_HANDLERS` (add secret ops)
- `deploy/kind/control-plane/tenant-store.mjs` — `ensureSchema` (~line 228) adds `outcome`, `prev_hash`, `row_hash` columns
- `deploy/kind/control-plane/audit-hash.mjs` — NEW: pure helpers `auditCanonical`, `computeRowHash`, `verifyAuditChain`
- `tests/blackbox/audit-write-and-scope-enforcement.test.mjs` — update in-memory pool stub for new columns/txn/advisory-lock no-ops
- Public read shape: `GET /v1/metrics/tenants/{id}/audit-records` records gain `outcome`, `rowHash`, `prevHash` fields
