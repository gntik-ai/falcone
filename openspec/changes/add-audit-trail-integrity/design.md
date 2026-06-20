## Context

The kind control-plane (`deploy/kind/control-plane/`) persists audit events in `plan_audit_events` (Postgres). The table is created idempotently by `tenant-store.mjs::ensureSchema` (~line 228). Reads are served by `audit-store.mjs::auditRowToRecord`; writes by `audit-store.mjs::recordAuditEvent`. Route-level dispatch and filtering are in `audit-writer.mjs` (`auditEventForRoute`, `AUDITABLE_LOCAL_HANDLERS`). The existing blackbox test (`tests/blackbox/audit-write-and-scope-enforcement.test.mjs`) uses an in-memory pool stub.

Current gaps confirmed in source:
- `auditRowToRecord` hardcodes `result.outcome = 'succeeded'` — no `outcome` column exists (`audit-store.mjs`).
- `auditEventForRoute` returns `null` for `status >= 400`, silently dropping failures and denials (`audit-writer.mjs`).
- `AUDITABLE_LOCAL_HANDLERS` omits `secretSet`, `secretGet`, `secretList`, `secretDelete` (`audit-writer.mjs`).
- `plan_audit_events` has no `prev_hash`/`row_hash` columns — the log is not tamper-evident (`tenant-store.mjs`).

## Goals / Non-Goals

**Goals:**
- True outcome stored at INSERT time and read from the DB column.
- Every auditable action (including 4xx/5xx) produces an audit record.
- Secret-access operations are in the auditable set.
- Each tenant has an independent append-only SHA-256 hash chain over audit rows.
- Pure `audit-hash.mjs` functions that are independently unit-testable.
- Backward compatibility: NULL `outcome` rows read as `'unknown'`; `verifyAuditChain` starts from the first non-null-hash row.

**Non-Goals:**
- Login/signup auditing (principal is in the result, cross-realm tenant resolution — deferred).
- Auditing module-based (non-local) routes (deferred).
- HMAC signing with a server key (the chain already provides append-only tamper-evidence without key management).
- Streaming or real-time audit chain verification (deferred).

## Decisions

**Schema migration via idempotent ALTER TABLE.** Three `ALTER TABLE plan_audit_events ADD COLUMN IF NOT EXISTS` statements are added to `ensureSchema` for `outcome TEXT`, `prev_hash TEXT`, and `row_hash TEXT`. Running on kind at boot is idempotent; no separate migration runner is needed.

**Outcome derived at write time in `auditEventForRoute`.** The function receives `result.statusCode` and maps it to `outcome` string before passing to `recordAuditEvent`. This means `auditRowToRecord` simply reads the column; no mapping logic at read time.

**App-side `id` and `created_at` generation.** `recordAuditEvent` generates `id` (UUID v4) and `created_at` (ISO timestamp) in JavaScript before the INSERT. This ensures both values are available for hash computation before the row hits the DB.

**Per-tenant advisory lock for chain serialization.** `pg_advisory_xact_lock(hashtext('audit:' || tenantId))` is acquired at the start of the transaction. This serializes concurrent audit writes for one tenant while allowing different tenants to write concurrently. Advisory locks are transaction-scoped (released on commit/rollback automatically).

**Pure `audit-hash.mjs` module.** Exports three functions with no I/O or DB dependencies:
- `auditCanonical(fields)` — deterministic JSON-like string of canonical fields in a fixed key order: `id`, `action_type`, `actor_id`, `tenant_id`, `outcome`, `created_at`, `new_state`.
- `computeRowHash(canonical, prevHash)` — `sha256(canonical + prevHash)` as lowercase hex, using Node's built-in `crypto.createHash`.
- `verifyAuditChain(rowsAscending)` — iterates rows; for each row recomputes the expected `row_hash` from canonical fields + the previous row's `row_hash` (or `''` for index 0); returns `{ valid: true, brokenAt: null }` on success or `{ valid: false, brokenAt: i }` on first mismatch. Rows with a null/absent `row_hash` (pre-migration rows) are skipped (chain starts from the first hashed row).

**Read shape extension.** `auditRowToRecord` maps DB columns `outcome`, `prev_hash`, `row_hash` to response fields `outcome`, `prevHash`, `rowHash`. NULL outcome → `'unknown'`.

**`AUDITABLE_LOCAL_HANDLERS` addition.** Four secret-operation entries are appended. Each must provide `ctx.identity` and `ctx.params.workspaceId` (confirmed available in the handler call site in `server.mjs`).

**Non-blocking write path.** Existing callers use `void recordRouteAudit(...)` (fire-and-forget). The advisory-lock + transaction adds latency to the write, not to the request path. Audit write failures are logged, never propagated to the HTTP response.

## Risks / Trade-offs

- **Advisory lock contention:** high-frequency auditable actions from one tenant will serialize at the DB level. Acceptable on kind (low concurrency); a future high-throughput path can batch-insert and compute the chain in the writer.
- **App-side clock vs. DB clock:** `created_at` is generated in JavaScript (`Date.now()`). Clock skew between app instances is possible but negligible on kind (single instance). The hash covers the app-generated value, so verification is consistent.
- **NULL rows from before migration:** rows without `row_hash` break the chain for old data. `verifyAuditChain` skips leading null-hash rows, so a tenant can still verify the post-migration chain.
