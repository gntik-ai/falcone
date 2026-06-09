## Context

The `webhook_signing_secrets` table is the only table in the webhook engine that
lacks `tenant_id`/`workspace_id` columns. Its siblings — `webhook_subscriptions`
and `webhook_deliveries` — both carry these columns and have composite indexes on
them. The signing-secrets table is accessed via a `subscription_id` FK join; the
subscription row provides the tenant context at query time. The gap is that if the
join is bypassed (direct select by `subscription_id`) or a query regression drops
the join, there is no tenant predicate on the most sensitive table in the engine.

The fix is purely additive: add two columns, back-fill from the parent, add an
index, and update query predicates. No HTTP contract changes; no new routes.

## Goals / Non-Goals

**Goals:**
- Add `tenant_id`/`workspace_id` columns to `webhook_signing_secrets`.
- Back-fill from `webhook_subscriptions` in the migration.
- Add composite index for efficient tenant-scoped scans.
- Update all secret read/rotation query paths to include the compound predicate.
- Make cross-tenant secret retrieval structurally impossible (not just guarded by application logic).

**Non-Goals:**
- Adding Row-Level Security policies (tracked separately under `feat-rls-enforced-migrations`; this change is a prerequisite that adds the columns RLS would need).
- Changes to the HMAC signing algorithm or key management.
- HTTP API changes.

## Decisions

**D1 — Back-fill via a single UPDATE in the migration.**
Rationale: `webhook_signing_secrets.subscription_id` already references
`webhook_subscriptions(id)` with a FK constraint, so the join is safe and the
back-fill is a single `UPDATE webhook_signing_secrets wss SET tenant_id = ws.tenant_id, workspace_id = ws.workspace_id FROM webhook_subscriptions ws WHERE wss.subscription_id = ws.id`.
Zero ambiguity; runs in one transaction.

**D2 — Add NOT NULL constraint after back-fill, not before.**
Rationale: Standard migration pattern — add column as nullable, back-fill, then
apply `ALTER COLUMN ... SET NOT NULL`. Avoids locking issues on existing rows.

**D3 — Update query predicates in application code, not just rely on the index.**
Rationale: The index makes tenant-scoped queries efficient; the predicate in the
query makes isolation a hard requirement that survives future query changes. Both
are needed: the column alone does not protect against a query that omits the
predicate.

**D4 — Add a CHECK/application-level guard that `tenant_id` matches the parent
subscription.**
Rationale: Prevents a future INSERT that supplies a mismatched `tenant_id` (e.g.
operator error during manual data migration). Implemented as a trigger or
application-layer assertion at insert time.

## Risks / Trade-offs

**Risk: Migration back-fill on a large `webhook_signing_secrets` table causes
table lock.**
Mitigation: Run the UPDATE in batches if the table is large; add the NOT NULL
constraint with a `VALIDATE CONSTRAINT` approach (Postgres: add as NOT VALID,
then validate separately) to avoid a full-table lock.

**Risk: A query path that loads secrets via a raw `subscription_id` without the
tenant predicate is missed.**
Mitigation: Code search for all references to `webhook_signing_secrets` in
`services/webhook-engine/src/` before closing the task; add a lint/test that
asserts no query omits the tenant predicate.

## Migration Plan

1. Add migration `services/webhook-engine/migrations/002-signing-secret-tenant-scope.sql`:
   - `ALTER TABLE webhook_signing_secrets ADD COLUMN tenant_id TEXT, ADD COLUMN workspace_id TEXT`
   - Back-fill: `UPDATE webhook_signing_secrets wss SET tenant_id = ws.tenant_id, workspace_id = ws.workspace_id FROM webhook_subscriptions ws WHERE wss.subscription_id = ws.id`
   - `ALTER TABLE webhook_signing_secrets ALTER COLUMN tenant_id SET NOT NULL, ALTER COLUMN workspace_id SET NOT NULL`
   - `CREATE INDEX idx_wss_tenant_workspace ON webhook_signing_secrets (tenant_id, workspace_id)`
2. Update all `SELECT … FROM webhook_signing_secrets WHERE subscription_id = $1` queries to add `AND tenant_id = $N AND workspace_id = $M`.
3. Update INSERT paths to propagate `tenant_id`/`workspace_id` from the subscription context.
4. Run `bash tests/blackbox/run.sh` to confirm no regressions.
