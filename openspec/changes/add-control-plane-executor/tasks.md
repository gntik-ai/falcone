## 0. Prerequisite check

- [ ] 0.1 Confirm `add-workspace-db-connection-registry` is applied (or confirm tests/env PG* env-var fallback is sufficient for the first slice); document which path is taken
- [ ] 0.2 Confirm `openspec validate add-control-plane-executor --strict` passes before implementation begins

## 1. Failing black-box / real-stack tests (write first)

- [ ] 1.1 Add test to `tests/env/`: start `apps/control-plane/server.mjs` pointing at the tests/env Postgres; issue `GET /healthz`; assert HTTP 200 — confirm it FAILS (no server yet)
- [ ] 1.2 Add test: issue a request for a postgres-data list route WITHOUT `X-Verified-Tenant-Id`; assert HTTP 401
- [ ] 1.3 Add test: issue `GET /v1/nonexistent/endpoint` with valid identity headers; assert HTTP 404 with `code: "NO_ROUTE"`
- [ ] 1.4 Add test: issue a postgres-data list request with valid identity headers against a real table in tests/env Postgres; assert HTTP 200 and a response body containing row data (not the raw plan object)
- [ ] 1.5 Add test: issue a postgres-data get request for a known row; assert HTTP 200 and the correct single-row response
- [ ] 1.6 Add test: trigger a Postgres error (query against a non-existent table); assert the response is a 5xx with `code` and `message` and that the response body does NOT contain any stack trace text or SQL query text
- [ ] 1.7 Confirm all new tests FAIL (red) before any implementation

## 2. Postgres executor

- [ ] 2.1 Create `apps/control-plane/executor/postgres.mjs` — accepts `{sql:{text,values}}` plan + a `pg.Pool` instance; calls `pool.query(plan.sql.text, plan.sql.values)`; returns `{rows, rowCount}`
- [ ] 2.2 Implement error mapping in executor: catch `pg.DatabaseError`; map PG error code 23505 → HTTP 409, 23503 → HTTP 422, connection-class errors (08*) → HTTP 502, all others → HTTP 500; return `{statusCode, body:{code,message}}` — no stack trace, no SQL text, no `detail`/`hint` fields
- [ ] 2.3 Confirm executor module has zero top-level side effects (no pool created at import time)

## 3. Server entrypoint

- [ ] 3.1 Create `apps/control-plane/server.mjs` — reads `PORT` (default 8080), `DB_URL` / `PG*` env vars; creates a `pg.Pool`; loads route table from `apps/control-plane/openapi/families/*.openapi.json`
- [ ] 3.2 Implement identity extraction: read `X-Verified-Tenant-Id` (primary) or `X-Tenant-Id` (fallback) and `X-Verified-Workspace-Id`; return 401 with `{code:"MISSING_IDENTITY"}` if absent or empty
- [ ] 3.3 Implement route matching: compile OpenAPI path templates to `RegExp` with named groups (mirrors `deploy/kind/control-plane/server.mjs::compilePath` from branch); return 404 `{code:"NO_ROUTE"}` on no match
- [ ] 3.4 Implement dispatch: for postgres-data routes call `buildPostgresDataApiPlan` from `services/adapters/src/postgresql-data-api.mjs`; pass the resulting plan to `executor/postgres.mjs`; shape the response per the OpenAPI response schema
- [ ] 3.5 Add `/healthz` endpoint returning `{status:"ok"}` with HTTP 200 (no auth required)
- [ ] 3.6 Ensure unhandled exceptions are caught at the request level and return `{code:"INTERNAL_ERROR"}` with HTTP 500 — no stack trace in the response body

## 4. Dockerfile

- [ ] 4.1 Create `apps/control-plane/Dockerfile` — `FROM node:22-alpine`; `WORKDIR /app`; COPY `apps/control-plane/package.json`; `RUN npm install --omit=dev`; COPY server + executor sources; COPY `services/adapters` and `services/internal-contracts` under `/repo/`; `EXPOSE 8080`; `CMD ["node","server.mjs"]`
- [ ] 4.2 Confirm the image builds locally (`docker build -f apps/control-plane/Dockerfile -t falcone-cp-test .`) before updating Helm values

## 5. Helm wiring

- [ ] 5.1 Update `charts/in-falcone/values.yaml` `controlPlane.image.repository` to the real image registry path (replace `ghcr.io/example/in-falcone-control-plane`)
- [ ] 5.2 Update `controlPlane.image.tag` to the build tag corresponding to this change

## 6. Verify

- [ ] 6.1 Run `bash tests/blackbox/run.sh` — all tests from section 1 are green; no regressions in existing suites
- [ ] 6.2 Run the tests/env real-stack slice manually: `node apps/control-plane/server.mjs` against tests/env Postgres; confirm postgres-data list and get return real rows
- [ ] 6.3 Run `openspec validate add-control-plane-executor --strict`
