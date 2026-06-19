## Why

`services/webhook-engine` is code-complete (subscription CRUD, HMAC signing, AES-GCM secret-at-rest, SSRF guard, tenant/workspace scoping) but is not wired onto the kind control-plane runtime: no `/v1/webhooks/*` APISIX route exists (`deploy/kind/apisix/apisix.yaml`), so requests fall through the catch-all route 5000 to `falcone-control-plane:8080`, and the kind control-plane route table (`deploy/kind/control-plane/routes.mjs`) has no webhook handler, so every webhook management request returns `{code:'NO_ROUTE'}`. GitHub issue #643.

## What Changes

- Add APISIX route `2019-webhooks` for `/v1/webhooks/*` → `falcone-control-plane:8080` in `deploy/kind/apisix/apisix.yaml` (before catch-all route 5000).
- Add `deploy/kind/control-plane/webhook-handlers.mjs` — a local handler (`webhookManage`) that lazily imports `main` from `services/webhook-engine/actions/webhook-management.mjs`, builds the `db` adapter from the pool, maps the request context to the action's `params`, and returns `{statusCode, body}`.
- Add `deploy/kind/control-plane/webhook-db.mjs` — a Postgres-backed `db` adapter implementing the ~12 methods required by the webhook management action; every query that supports tenant scoping includes a `(tenant_id, workspace_id)` predicate.
- Add `deploy/kind/control-plane/webhook-schema.mjs` — idempotent bootstrap applying migrations 001 and 002 (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) at server startup alongside `applyGovernanceSchema`.
- Register the handler in `deploy/kind/control-plane/b-handlers.mjs` via a `...WEBHOOK_HANDLERS` spread into `LOCAL_HANDLERS`.
- Update the kind control-plane `Dockerfile` to `COPY` the three new handler modules and `COPY services/webhook-engine /repo/services/webhook-engine`.
- Add `WEBHOOK_SIGNING_KEY` and `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` to `values-kind.yaml` under `controlPlane.env`.

Out of scope (explicit follow-up): the outbound delivery-execution loop (dispatcher → delivery-worker → retry-scheduler) requires a background event consumer that does not exist on the kind runtime and will be a separate change. The `/deliveries` read endpoints are wired and return empty lists until the delivery loop is implemented.

## Capabilities

### New Capabilities

None — the webhook engine service already has existing specs under `openspec/specs/webhooks/`.

### Modified Capabilities

- `webhooks`: ADD requirements for the management/subscription plane being reachable through the gateway on the kind runtime, tenant/workspace isolation enforcement in the runtime db adapter, and idempotent schema bootstrap at server startup.

## Impact

- `deploy/kind/apisix/apisix.yaml`: new upstream/route for `/v1/webhooks/*`.
- `deploy/kind/control-plane/`: three new modules (`webhook-handlers.mjs`, `webhook-db.mjs`, `webhook-schema.mjs`); edits to `b-handlers.mjs`, `server.mjs`, `Dockerfile`.
- `charts/in-falcone/values-kind.yaml` (or equivalent): two new env vars.
- The legacy `deploy/apisix/routes/webhooks.yaml` (pointing at the removed OpenWhisk upstream) is NOT removed in this change — that is a separate cleanup.
- No breaking changes to existing webhook service behaviour; routes that were previously unreachable (returning `NO_ROUTE`) become functional.
