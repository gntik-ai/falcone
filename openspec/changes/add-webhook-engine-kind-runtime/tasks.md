# Tasks — add-webhook-engine-kind-runtime

## 1. Reproduce (test-first)

- [x] 1.1 Failing real-stack-style test `tests/blackbox/webhook-db-adapter.test.mjs`: drives the Postgres db adapter via a recording pool stub — asserts every tenant-scoped query carries a `(tenant_id, workspace_id)` predicate + correct params + return mapping (count/list/insert-secret/rotate/cancel/get). Failed before the adapter existed.
- [x] 1.2 Failing black-box route test `tests/blackbox/webhook-management-routes.test.mjs`: drives the `webhookManage` local handler against an in-memory multi-tenant db — event-types→200, create→201 (+signingSecret), quota→409, list scoping, cross-tenant→404, pathname parse, route-table wiring guard. Failed before the handler existed.
- [x] 1.3 (added) `tests/blackbox/webhook-schema-bootstrap.test.mjs`: asserts `applyWebhookSchema` applies migrations 001+002 only with idempotent DDL and does NOT enable RLS/create policies (003 deferred).

## 2. Schema bootstrap

- [x] 2.1 `deploy/kind/control-plane/webhook-schema.mjs` — `applyWebhookSchema(pool)` applies migrations 001 (tables) + 002 (tenant columns) idempotently; comment explains the FORCE-RLS (003) deferral.
- [x] 2.2 `server.mjs` calls `applyWebhookSchema(pool)` in the boot retry block alongside `applyGovernanceSchema(pool)`.

## 3. Postgres db adapter

- [x] 3.1 `deploy/kind/control-plane/webhook-db.mjs` — `buildWebhookDb(pool)` implements the 12 methods; every tenant-scoped method carries `(tenant_id, workspace_id)` predicates (`getSubscription` returns the raw row by contract — the action applies the tenant check).
- [x] 3.2 Adapter verified by the test from 1.1 (all green; tenant predicates asserted on every scoped query).

## 4. Local handler wiring

- [x] 4.1 `deploy/kind/control-plane/webhook-handlers.mjs` — exports `WEBHOOK_HANDLERS` + `webhookManage`; lazily dynamic-imports `main` from `${REPO_ROOT}/services/webhook-engine/actions/webhook-management.mjs`, builds the db via `buildWebhookDb(ctx.pool)`, maps ctx→params (method + pathname from `ctx.req.url`, body, query, `auth` from verified `ctx.identity`), returns `{statusCode, body}`. Test seam `{ buildDb }`.
- [x] 4.2 `...WEBHOOK_HANDLERS` spread into `LOCAL_HANDLERS` in `b-handlers.mjs`; 11 webhook routes added to `routes.mjs` (all `localHandler: 'webhookManage'`, `auth: 'authenticated'`).

## 5. APISIX route

- [x] 5.1 Route `2019-webhooks` (`/v1/webhooks/*` → `falcone-control-plane:8080`, priority 224, cors) added to `deploy/kind/apisix/apisix.yaml`, above the catch-all 5000.

## 6. Dockerfile

- [x] 6.1 `Dockerfile` COPYs `webhook-handlers.mjs`, `webhook-db.mjs`, `webhook-schema.mjs` into `/app`.
- [x] 6.2 `COPY services/webhook-engine /repo/services/webhook-engine` so the lazy dynamic import + migration reads resolve at runtime.

## 7. Environment configuration

- [x] 7.1 `WEBHOOK_SIGNING_KEY` (dev placeholder, not secret-shaped; comment: prod uses `secretKeyRef`) and `WEBHOOK_MAX_SUBSCRIPTIONS_PER_WORKSPACE` added to `controlPlane.env` in `values-kind.yaml`.

## 8. Verify

- [x] 8.1 `bash tests/blackbox/run.sh` — 1011 pass / 0 fail (incl. 14 new webhook tests).
- [x] 8.2 No regression: webhook contract + integration tests pass; all kind control-plane modules `node --check` clean; `LOCAL_HANDLERS.webhookManage` resolves.
- [x] 8.3 Live kind verification (test-cluster-b): rebuilt + pushed the control-plane image, rolled `falcone-control-plane`, confirmed boot log `webhook schema ready (2 migrations)`. Through the gateway with real `tenant_owner` principals (acme-ops/globex-ops) + real Postgres + Keycloak: unauth `event-types`→401 (wired, was 404); `GET .../webhooks/event-types`→200; `POST /v1/workspaces/{ws}/webhooks/subscriptions` (own ws)→**201** (+signingSecret); list→200 count=1; globex `CREATE`/`list` on acme's ws→**404** (cross-tenant blocked); `DELETE`→204. Reverted the deployment to the prior image afterward.
  - Finding driving the workspace-path form: the tenant-addressed `POST /v1/webhooks/subscriptions` failed `TENANT_SCOPE_REQUIRED` because real principals (tenant_owner) carry no `workspace_id` in the JWT — so the surface is also served under `/v1/workspaces/{workspaceId}/webhooks/...` (workspace from path, authorized against the caller's tenant), which is the reachable/usable form and rides the existing gateway route `/v1/workspaces/*`.

## 9. Archive

- [x] 9.1 `openspec validate add-webhook-engine-kind-runtime --strict` — clean.
- [ ] 9.2 `/opsx:archive add-webhook-engine-kind-runtime` after merge.
