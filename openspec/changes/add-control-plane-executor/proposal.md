## Why

`apps/control-plane` is a library with no HTTP server and no Dockerfile. The Helm chart (`charts/in-falcone/values.yaml` line 2092) targets placeholder image `ghcr.io/example/in-falcone-control-plane:0.1.0`. APISIX (`services/gateway-config/base/public-api-routing.yaml`) authenticates bearer_oidc and routes `/v1/*` to `upstreamService: control_api` — which does not run — causing every data-plane call to return 503. `services/adapters/src/postgresql-data-api.mjs::buildPostgresDataApiPlan` (line 1793) builds `{sql:{text,values}}` plans but never executes them: there are no `pg`/`mongodb`/`kafkajs`/S3 imports in any adapter. A working partial runtime exists on branch `add/control-plane-runtime-knative-openshift` at `deploy/kind/control-plane/server.mjs` (JWT validation, route dispatch, `pg` Pool injection) — the proof that the architecture works. This change promotes that runtime to production shape: real HTTP service, executor over adapter plan-builders, Dockerfile, and Helm wiring.

## What Changes

- Add `apps/control-plane/server.mjs` — Node HTTP server: loads OpenAPI families as route table; reads gateway-injected identity headers (`X-Verified-Tenant-Id`, `X-Verified-Workspace-Id` from `services/gateway-config/plugins/scope-enforcement.lua` lines 405-406); dispatches each `(method, path)` to the matching adapter `build*Plan`; runs the plan via a per-backend executor.
- Add `apps/control-plane/executor/postgres.mjs` — Postgres executor: accepts a `{sql:{text,values}}` plan from `buildPostgresDataApiPlan`; runs it against a `pg.Pool`; shapes the response per the OpenAPI schema. First backend slice (list + get operations).
- Add `apps/control-plane/Dockerfile` — build context is repo root; copies `services/adapters`, `services/internal-contracts`, and `apps/control-plane`; installs `pg` and `jose`; exposes port 8080.
- Update `charts/in-falcone/values.yaml` `controlPlane.image` to reference the real image repository and build tag.
- Prerequisite: `add-workspace-db-connection-registry` (provides DB connection metadata per workspace; this change reads from it).

## Capabilities

### New Capabilities

- `control-plane-runtime`: A running control-plane HTTP service that authenticates from gateway-injected identity headers, dispatches requests to adapter plan-builders, executes the resulting SQL plans against real Postgres, and returns shaped responses; the Dockerfile and Helm wiring that replace the placeholder image.

### Modified Capabilities

## Impact

- New files: `apps/control-plane/server.mjs`, `apps/control-plane/executor/postgres.mjs`, `apps/control-plane/Dockerfile`
- Modified: `charts/in-falcone/values.yaml` `controlPlane.image` block (lines 2091-2094)
- Reference (reused, not modified): `services/adapters/src/postgresql-data-api.mjs::buildPostgresDataApiPlan` (line 1793); `deploy/kind/control-plane/server.mjs` (branch `add/control-plane-runtime-knative-openshift`)
- Gateway routes already target `control_api`; no gateway changes required
- Prerequisite change: `add-workspace-db-connection-registry`
