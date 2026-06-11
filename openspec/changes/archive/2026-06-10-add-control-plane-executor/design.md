## Context

`apps/control-plane` is a pure library — it exports action modules callable as `main(params, overrides)` but ships no HTTP server and no Dockerfile. The Helm chart (`charts/in-falcone/values.yaml:2092`) targets placeholder image `ghcr.io/example/in-falcone-control-plane:0.1.0`. APISIX routes all `/v1/*` traffic to `upstreamService: control_api` (public-api-routing.yaml lines 232, 250, 263 ...) with `authMode: bearer_oidc`; the `scope-enforcement` plugin verifies the token and injects `X-Verified-Tenant-Id` / `X-Verified-Workspace-Id` (scope-enforcement.lua lines 405-406). Because no process listens, every data-plane call returns 503.

`services/adapters/src/postgresql-data-api.mjs::buildPostgresDataApiPlan` (line 1793) builds parameterized SQL plans as `{sql:{text,values}}` but never executes them — the adapter has no `pg` import. The pattern is deliberate: plan-builders are pure functions, testable without a database.

Branch `add/control-plane-runtime-knative-openshift` at `deploy/kind/control-plane/server.mjs` proves the architecture: JWT validation via `jose`/JWKS, route table compiled from path templates with named groups, `pg.Pool` DI injected into action invocations. The branch's `pg-handlers.mjs` and `b-handlers.mjs` demonstrate direct `pg.Pool` usage. The Dockerfile (branch) uses build-context = repo root to COPY `services/adapters`, `services/internal-contracts`, and `apps/control-plane` under `/repo`, installs `pg` + `jose`, and runs `node server.mjs`.

This change promotes that pattern into `apps/control-plane/` as a first-class product artifact, replacing ad-hoc deploy scripts with a permanent home.

## Goals / Non-Goals

**Goals:**
- Ship `apps/control-plane/server.mjs` — the HTTP runtime: loads route table from OpenAPI families, reads `X-Verified-Tenant-Id` / `X-Verified-Workspace-Id` from gateway-injected headers, dispatches `(method, path)` to the matching adapter plan-builder, runs the plan via the Postgres executor.
- Ship `apps/control-plane/executor/postgres.mjs` — the Postgres executor: accepts `{sql:{text,values}}`, runs it on a `pg.Pool`, shapes rows into the OpenAPI response envelope, maps Postgres error codes to sanitized HTTP responses.
- Ship `apps/control-plane/Dockerfile` — production image; build context is repo root.
- Update `charts/in-falcone/values.yaml` `controlPlane.image` to reference the real repository.
- First slice: postgres-data `list` and `get` operations returning real rows end-to-end.

**Non-Goals:**
- Implementing Supabase-style anon + service key auth (separate change `add-app-auth-keys`).
- Row-level security enforcement (separate change `add-rls-enforced-tenant-migrations`).
- Realtime/subscriptions (deferred per locked architecture decisions).
- Other families (mongo, events, functions, storage) — they plug into the same executor pattern in later changes.
- Data migration or schema changes.

## Decisions

**D1 — Executor calls `build*Plan` then executes; it does not re-implement query logic.**
Rationale: `buildPostgresDataApiPlan` is the authoritative source of parameterized SQL for the postgres-data family. Reimplementing query logic in the executor would diverge. The executor's only job is: call the plan-builder, submit `plan.sql.text` + `plan.sql.values` to `pg.Pool.query()`, shape the result.

**D2 — Identity is read exclusively from gateway-injected headers, not from a re-verified JWT.**
Rationale: The `scope-enforcement` APISIX plugin is the trust boundary. It verifies the token and injects `X-Verified-Tenant-Id`. The control-plane service operates inside the trust boundary and MUST NOT re-verify or shadow the gateway's identity decision — this is the same model as `tests/env/action-runner`. A missing or empty header is the only rejection condition; it means the request bypassed the gateway.

**D3 — Route table is loaded from OpenAPI families at startup, not hard-coded.**
Rationale: `apps/control-plane/openapi/families/*.openapi.json` is the authoritative surface. Loading the route table from these files keeps the runtime in sync as families evolve, using the same discovery pattern as `deploy/kind/control-plane/route-map.runtime.json` on the branch.

**D4 — Error sanitization at the executor boundary.**
Rationale: Postgres errors (`pg.DatabaseError`) carry `detail`, `hint`, `query` fields that MUST NOT be forwarded to API consumers. The executor catches all `pg.DatabaseError` instances, maps `code` to an HTTP status (23505 → 409, 23503 → 422, connection errors → 502), and returns only `{code, message}` — no stack trace, no SQL text, no connection string.

**D5 — `apps/control-plane/` is the production home; `deploy/kind/control-plane/` is the branch prototype.**
Rationale: Promotes the runtime to a permanent artifact under the standard app namespace. The branch files become redundant once this change lands.

## Risks / Trade-offs

**Risk: Prerequisite `add-workspace-db-connection-registry` not yet landed — executor has no connection metadata.**
Mitigation: Tasks gate on the prerequisite. In tests/env the executor reads standard `PG*` environment variables as a fallback, matching the branch pattern.

**Risk: Adapter plan-builders may throw for inputs not yet covered by the executor (e.g. unsupported operations in the first slice).**
Mitigation: The executor returns HTTP 501 for unimplemented operations rather than crashing; covered by a black-box test.

**Risk: `scope-enforcement.lua` injects `X-Verified-Tenant-Id` but tests/env uses a different header trust model (action-runner trusts gateway headers directly).**
Mitigation: The server reads whichever of `X-Verified-Tenant-Id` / `X-Tenant-Id` is present, mirroring the action-runner pattern, so tests/env and production use compatible paths.

## Migration Plan

1. Add `apps/control-plane/executor/postgres.mjs` — pure executor module; no existing files modified.
2. Add `apps/control-plane/server.mjs` — imports executor; reads route table from `openapi/families/`; listens on `PORT` (default 8080).
3. Add `apps/control-plane/Dockerfile` — build context repo root; mirrors branch Dockerfile structure.
4. Update `charts/in-falcone/values.yaml` `controlPlane.image.repository` and `tag` to the real build reference.
5. Wire real-stack tests (tests/env) against the server: start it with live Postgres, issue postgres-data list/get, assert real rows.
6. Run `bash tests/blackbox/run.sh` to confirm no regressions.
