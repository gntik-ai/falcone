## Context

`services/webhook-engine/actions/webhook-management.mjs` is a single-argument OpenWhisk-style handler (`main(params)` returning `{statusCode, body}`). It requires two injected dependencies at call time: a `db` object (~12 methods) and an `auth` object (`{tenantId, workspaceId, actorId}`). The kind control-plane runtime (`deploy/kind/control-plane/`) already implements this injection pattern for other domain handlers (storage, mongo, functions) via local-handler modules registered in `b-handlers.mjs`. No Postgres-backed `db` adapter exists yet; tests inject an in-memory stub. The three webhook SQL migrations live under `services/webhook-engine/migrations/` (001 = tables, 002 = tenant/workspace columns on secrets, 003 = FORCE RLS). The kind runtime bootstraps its own schema via `applyGovernanceSchema` in `server.mjs`.

## Goals / Non-Goals

**Goals:**
- Make all webhook management/subscription plane routes (`/v1/webhooks/*`) reachable and functional on the kind runtime end-to-end.
- Enforce tenant/workspace isolation in the Postgres adapter SQL so that cross-tenant data is never returned at the query layer.
- Bootstrap the webhook schema idempotently at server startup (no manual migration step required).

**Non-Goals:**
- The outbound delivery-execution loop (dispatcher, delivery worker, retry scheduler) — this requires a background event consumer not present on kind and is a separate change.
- Applying migration 003 (FORCE RLS keyed on `current_setting('app.tenant_id')`) — deferred until the RLS rollout change adds the `SET LOCAL app.tenant_id` connection wrapper; applying 003 without the wrapper would silently return zero rows for every webhook query.
- Removing the legacy `deploy/apisix/routes/webhooks.yaml` (pointing at the removed OpenWhisk upstream) — separate cleanup.
- Real-time event delivery or Kafka consumer wiring.

## Decisions

### 1. Wire as a control-plane local handler (`webhook-handlers.mjs`)

The kind control-plane already dispatches domain routes via `LOCAL_HANDLERS` entries in `b-handlers.mjs`. Each entry is a function `(ctx) → {statusCode, body}` that lazily imports the service action module and builds its dependencies from `ctx.pool`/`ctx.identity`. Mirroring this pattern (storage handlers, mongo handlers, fn handlers) for webhooks keeps the wiring uniform and avoids a second HTTP hop.

Alternative considered: proxy to a standalone webhook-engine sidecar container. Rejected — adds operational complexity (second Deployment, port config, inter-pod networking) with no benefit for the kind dev runtime.

### 2. Postgres-backed `db` adapter in `webhook-db.mjs`

The adapter implements the ~12 methods the webhook management action expects: `getWorkspaceSubscriptionCount`, `insertSubscription`, `insertSecret`, `listSubscriptions`, `getSubscription`, `updateSubscription`, `replaceSubscription`, `cancelPendingDeliveries`, `rotateSecret`, `listDeliveries`, `getDelivery`. Every method that reads or writes subscriptions/secrets includes a `(tenant_id, workspace_id)` predicate where the action supplies those values. `getSubscription(id)` returns the raw row scoped only by `id`; the action's own `requireSubscription` JS check rejects cross-tenant access based on the returned row's `tenant_id` — consistent with the action's existing design.

### 3. Schema bootstrap: migrations 001 + 002 only (`webhook-schema.mjs`)

`applyWebhookSchema(pool)` applies migrations 001 and 002 idempotently (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). It is called from `server.mjs` alongside `applyGovernanceSchema` at startup. Migration 003 (FORCE RLS) is explicitly deferred: its policies key on `current_setting('app.tenant_id')` and require a `SET LOCAL` wrapper per connection to be useful. Applying 003 without the wrapper makes every webhook query return zero rows. The deferred dependency is documented here and in the proposal.

### 4. APISIX route `2019-webhooks`

`/v1/webhooks/*` is added as route `2019-webhooks` in `deploy/kind/apisix/apisix.yaml` with upstream `falcone-control-plane:8080`, inserted before the catch-all route 5000. This matches the existing route style used by storage (`2010-storage`), mongo (`2012-mongo`), etc.

### 5. Dockerfile additions

Three new control-plane modules are added via `COPY` directives (`webhook-handlers.mjs`, `webhook-db.mjs`, `webhook-schema.mjs`) and the service source is made available via `COPY services/webhook-engine /repo/services/webhook-engine` so the lazy `dynamic import` of the action from `${REPO_ROOT}/services/webhook-engine/actions/webhook-management.mjs` resolves at runtime.

### 6. Environment variables (`values-kind.yaml`)

`WEBHOOK_SIGNING_KEY` (a dev placeholder value — not secret-shaped; prod uses `secretKeyRef`) and `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` are added to `controlPlane.env`. These are read from `process.env` and forwarded to the action via `params.env`.

## Risks / Trade-offs

- **FORCE RLS deferred** → Tenant isolation relies on app-level `(tenant_id, workspace_id)` predicates in the db adapter. If a code path omits a predicate, isolation is not enforced at the DB layer. Mitigation: cross-tenant probe in the adapter test suite; FORCE RLS rollout change tracked separately.
- **Lazy dynamic import path** → `REPO_ROOT` must be set correctly in the Dockerfile / runtime env. Mitigation: same convention as other domain handlers; fails fast at first request if misconfigured.
- **Migration 003 not applied** → FORCE RLS policies exist in the migration file but are intentionally not run on kind until the connection wrapper is in place. Mitigation: comment in `webhook-schema.mjs` explains the deferral; a TODO references the follow-up change.
- **`getSubscription` does not predicate on tenant** → cross-tenant check is delegated to the action layer's `requireSubscription`. This is correct per the action's existing design but relies on the action not being bypassed. Mitigation: black-box cross-tenant probe validates end-to-end rejection.

## Open Questions

- Should `WEBHOOK_SIGNING_KEY` be a Kubernetes Secret reference even on the kind dev cluster? Current decision: plain env value with a comment; no prod secrets in kind values. Revisit before production deployment.
