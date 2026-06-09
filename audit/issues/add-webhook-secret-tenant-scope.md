# Tenant/workspace scoping on webhook signing secrets

| Field | Value |
|---|---|
| **Change ID** | `add-webhook-secret-tenant-scope` |
| **Capability** | `webhooks` |
| **Type** | enhancement |
| **Priority** | P1 |
| **OpenSpec change** | `openspec/changes/add-webhook-secret-tenant-scope/` |

---

## Why

Every table in the webhook engine carries `tenant_id`/`workspace_id` columns **except `webhook_signing_secrets`**. The migration `services/webhook-engine/migrations/001-webhook-subscriptions.sql:21-31` defines:

```sql
CREATE TABLE IF NOT EXISTS webhook_signing_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES webhook_subscriptions(id),
  secret_cipher TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  grace_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wss_subscription ON webhook_signing_secrets (subscription_id) ...
```

No `tenant_id`, no `workspace_id`, no composite index. By contrast, `webhook_subscriptions` (lines 1-17) and `webhook_deliveries` (lines 33-52) both carry `tenant_id TEXT NOT NULL` / `workspace_id TEXT NOT NULL` with a `(tenant_id, workspace_id)` index each.

The signing-secrets table stores the most sensitive material in the webhook engine (HMAC signing-secret ciphertext + IV). Any query path reaching it by `subscription_id` alone — a join regression, a guessed/leaked subscription UUID, or a direct select — has no tenant predicate as a structural fallback. This is the one table in the webhook engine where the isolation invariant is structurally absent.

## What Changes

- Add `tenant_id TEXT NOT NULL` and `workspace_id TEXT NOT NULL` columns to `webhook_signing_secrets`, back-filled from the parent `webhook_subscriptions` row.
- Add index `idx_wss_tenant_workspace ON webhook_signing_secrets (tenant_id, workspace_id)`.
- Update all signing-secret read and rotation paths in `services/webhook-engine/src/` to include a compound `(tenant_id, workspace_id)` predicate alongside `subscription_id`.
- Add a consistency guard at INSERT time ensuring `tenant_id` matches the parent subscription.

## Spec delta (EARS)

- The system **SHALL** store `tenant_id` and `workspace_id` on every `webhook_signing_secrets` row, back-filled from the parent `webhook_subscriptions` record.
- The system **SHALL** include a `(tenant_id, workspace_id)` predicate on every query that reads from `webhook_signing_secrets`; a `subscription_id` alone is never sufficient to retrieve secret material.
- The system **SHALL** ensure no code path in the webhook engine can retrieve signing secrets belonging to one tenant on behalf of a different tenant, even given a known or guessed `subscription_id`.
- The system **SHALL** scope secret rotation to rows where `tenant_id` matches the caller's tenant; no row belonging to a different tenant is modified.

Full spec: `openspec/changes/add-webhook-secret-tenant-scope/specs/webhooks/spec.md`

## Tasks

See `openspec/changes/add-webhook-secret-tenant-scope/tasks.md` for the full checklist. Key groups:

1. Baseline — confirm green before starting
2. Black-box tests (write-first): column presence, cross-tenant predicate returns 0 rows, delivery signing uses only own-tenant secrets, rotation scoped to own tenant
3. Database migration — add columns, back-fill, NOT NULL constraint, composite index
4. Query predicate updates — audit all SELECT/UPDATE/INSERT against `webhook_signing_secrets`
5. Consistency guard — INSERT assertion that `tenant_id` matches parent subscription
6. Integration validation — `bash tests/blackbox/run.sh`

## Acceptance criteria

- Every `webhook_signing_secrets` row has `tenant_id` and `workspace_id` populated (no NULLs after migration).
- A query with Tenant A's `subscription_id` but Tenant B's `tenant_id` returns zero rows.
- Delivery signing for Tenant A's subscription loads only secrets where `tenant_id = Tenant A`.
- Secret rotation for Tenant A only modifies rows where `tenant_id = Tenant A`.
- An INSERT attempt with a mismatched `tenant_id` (not matching the parent subscription) is rejected.

## Code evidence

- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:21-31` — `webhook_signing_secrets` DDL: no `tenant_id`/`workspace_id` columns, only `subscription_id` FK and `idx_wss_subscription` index.
- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:1-17` — `webhook_subscriptions`: `tenant_id TEXT NOT NULL`, `workspace_id TEXT NOT NULL`, `idx_ws_tenant_workspace` index — present on sibling table, absent on secrets table.
- `services/webhook-engine/migrations/001-webhook-subscriptions.sql:33-52` — `webhook_deliveries`: `tenant_id TEXT NOT NULL`, `workspace_id TEXT NOT NULL`, `idx_wd_tenant_workspace` index — same pattern confirms convention is universal except for secrets.
- `services/webhook-engine/src/webhook-signing.mjs::verifyAgainstSecretSet` — receives `secretRecords` array; no tenant predicate visible at this layer; tenant scoping must be enforced in the caller's DB query.
- `services/webhook-engine/src/webhook-subscription.mjs::buildSubscriptionRecord` — propagates `tenant_id`/`workspace_id` from context onto subscriptions, confirming the context is available and could be forwarded to the secrets insert path.

## Resolution (OpenSpec)

```
/opsx:apply add-webhook-secret-tenant-scope
/opsx:verify add-webhook-secret-tenant-scope
bash tests/blackbox/run.sh
/opsx:archive add-webhook-secret-tenant-scope
```

Or use the wrapper: `/implement-change add-webhook-secret-tenant-scope`

Optional real-stack E2E: `/e2e-issue add-webhook-secret-tenant-scope`
