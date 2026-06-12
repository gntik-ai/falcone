## 1. Baseline and pre-flight

- [x] 1.1 Confirm baseline green: run `tests/blackbox/run.sh` and CI `quality` job; record pass/fail state before any code change — blackbox 408 pass / 0 fail; `test:unit` 592 pass; `test:contracts` 231 pass / 17 skipped; `validate:public-api`, `validate:domain-model`, `validate:deployment-topology` all green.
- [x] 1.2 Verify `TEMPORAL_ADDRESS` env var convention with #356 (Temporal client connection model) and record the agreed env var names in design.md OQ2 — confirmed from `services/workflow-worker/src/worker.ts`: `TEMPORAL_ADDRESS` (default `127.0.0.1:7233`), `TEMPORAL_NAMESPACE` (default `falcone-flows`), `TEMPORAL_TASK_QUEUE` (default `flows-main`). Search attributes `tenantId`/`workspaceId`/`flowId`/`flowVersion` are `Keyword` (ADR-11). Resolves OQ2.

## 2. Database migrations

> Location: `charts/in-falcone/bootstrap/migrations/` (the established control-plane migration dir, alongside `20260327-001-function-audit-records.sql`): `20260612-003-flow-definitions-and-versions.sql` (tables) + `20260612-004-flow-rls.sql` (RLS + grants). The flow store ALSO does in-code `ensureSchema()` (CREATE TABLE IF NOT EXISTS), mirroring `api-keys.mjs`/`embedding-executor.mjs`, so the metadata pool boots standalone; the `.sql` RLS migration is the auditable defense-in-depth backstop. Proven by `tests/env/flows-api/flows-rls.test.mjs`.

- [x] 2.1 Write idempotent migration for `flow_definitions` table (`tenant_id`, `workspace_id`, `flow_id`, `name`, `definition_yaml`, `definition_json`, `dsl_api_version`, `status`, `created_by`, `created_at`, `updated_at`); primary key `flow_id`; unique on `(tenant_id, workspace_id, flow_id)`
- [x] 2.2 Write idempotent migration for `flow_versions` table (`tenant_id`, `workspace_id`, `flow_id`, `version`, `definition_yaml`, `definition_json`, `dsl_api_version`, `created_by`, `created_at`); primary key `(flow_id, version)`
- [x] 2.3 Add RLS migration for both tables: `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, policy using `current_setting('app.tenant_id', true)` + `current_setting('app.workspace_id', true)`; `GRANT SELECT, INSERT, UPDATE, DELETE ON flow_definitions TO falcone_app`; `GRANT SELECT, INSERT ON flow_versions TO falcone_app` (no UPDATE/DELETE per D6)
- [x] 2.4 Verify migration idempotency: run twice against a local Postgres; confirm no error on re-run

## 3. Flow executor module

- [x] 3.1 Create `apps/control-plane/src/runtime/flow-executor.mjs` exporting `createFlowExecutor({ temporalAddress, temporalNamespace, logger })`; hold the sole `@temporalio/client` `Connection` and `WorkflowClient` instance
- [x] 3.2 Implement `executeFlows({ operation, tenantId, workspaceId, flowId, ... })` dispatch function handling all operations: `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `delete_definition`, `validate`, `publish_version`, `list_versions`, `get_version`, `start_execution`, `list_executions`, `get_execution`, `cancel_execution`, `retry_execution`, `send_signal`
- [x] 3.3 Implement server-side workflow ID generation: `${tenantId}:${workspaceId}:${flowId}:${crypto.randomUUID()}`; add a `parseWorkflowId` helper that validates the prefix matches `${identity.tenantId}:`
- [x] 3.4 Implement Temporal search-attribute injection on `start_execution` (per #356 model: `tenantId`, `workspaceId`, `flowId`, `flowVersion` as typed search attributes)
- [x] 3.5 Implement execution list via Temporal visibility query; mandatory `tenantId` filter injected server-side; map response to public execution shape
- [x] 3.6 Implement cancel, retry (new run from same version + input), and signal (with `signalName` validation against published DSL version's signal definitions)
- [x] 3.7 Return HTTP 503 with `code: TEMPORAL_UNAVAILABLE` when the Temporal client is disconnected; use lazy-connect pattern (connect on first use)

## 4. Server wiring

- [x] 4.1 Extend `buildRoutes()` signature in `server.mjs` to accept `flowExecutor`; add flows route tuples when `flowExecutor` is defined, using prefix `const fl = '^/v1/flows/workspaces/([^/]+)'`
- [x] 4.2 Add the following route tuples (method, RegExp, handler) inside `buildRoutes`:
  - `GET  /v1/flows/workspaces/{w}/flows` — list definitions
  - `POST /v1/flows/workspaces/{w}/flows` — create definition
  - `GET  /v1/flows/workspaces/{w}/flows/{f}` — get definition
  - `PATCH /v1/flows/workspaces/{w}/flows/{f}` — update draft
  - `DELETE /v1/flows/workspaces/{w}/flows/{f}` — delete definition
  - `POST /v1/flows/workspaces/{w}/flows/{f}/validate` — validate draft
  - `POST /v1/flows/workspaces/{w}/flows/{f}/versions` — publish version
  - `GET  /v1/flows/workspaces/{w}/flows/{f}/versions` — list versions
  - `GET  /v1/flows/workspaces/{w}/flows/{f}/versions/{v}` — get version
  - `POST /v1/flows/workspaces/{w}/flows/{f}/executions` — start execution
  - `GET  /v1/flows/workspaces/{w}/flows/{f}/executions` — list executions
  - `GET  /v1/flows/workspaces/{w}/flows/{f}/executions/{e}` — get detail
  - `POST /v1/flows/workspaces/{w}/flows/{f}/executions/{e}/cancellations` — cancel
  - `POST /v1/flows/workspaces/{w}/flows/{f}/executions/{e}/retries` — retry
  - `POST /v1/flows/workspaces/{w}/flows/{f}/executions/{e}/signals/{s}` — signal
- [x] 4.3 Extend `createControlPlaneServer` destructured parameter to include `flowExecutor`; thread it into `buildRoutes()` call
- [x] 4.4 Update `main.mjs`: import `createFlowExecutor`; conditionally instantiate when `TEMPORAL_ADDRESS` is set; pass to `createControlPlaneServer`; call `flowExecutor?.close()` in `shutdown()`

## 5. Public route catalog

> DEVIATION (verified against code, recorded in design.md D7-note): `services/internal-contracts/src/public-route-catalog.json` is NOT hand-editable — it is fully GENERATED from `apps/control-plane/openapi/control-plane.openapi.json` + `public-api-taxonomy.json` + `services/gateway-config/base/public-api-routing.yaml` (`scripts/lib/public-api.mjs`), and `validate:public-api` + `validate:gateway-policy` cross-check that every catalog entry matches an OpenAPI operation AND that every routing family has a Helm-chart APISIX route (`public-api-<id>`) + `gatewayPolicy.familyPolicies.<id>`. Introducing a real `flows` routing family would force out-of-scope edits to the Helm chart + gateway-config. The established in-scope convention (verified: the preceding `write-time-auto-embedding` change added its public routes here) is the hand-maintained flat allow-list `services/gateway-config/public-route-catalog.json` (`{method, path, privilege_domain}`), gated by a black-box route-catalog test. The spec's `gatewayRouteClass: control|data-control` maps 1:1 to `privilege_domain: structural_admin|data_access`. The generated OpenAPI catalog + gateway-routing family wiring is owned by the gateway-integration sibling change.

- [x] 5.1 Add all 15 flows route entries to the hand-maintained `services/gateway-config/public-route-catalog.json` (`method`, `path` using the public `/v1/flows/workspaces/{workspaceId}/…` shape, `privilege_domain`); tenant/workspace binding is enforced by the executor identity, not catalog fields (this flat catalog carries no binding columns)
- [x] 5.2 Set `privilege_domain: "structural_admin"` (≙ `gatewayRouteClass: control`) on definition-management routes (CRUD, validate, publish, version list/get) and `privilege_domain: "data_access"` (≙ `gatewayRouteClass: data-control`) on execution routes (start, list, detail, cancel, retry, signal)
- [x] 5.3 Generated-catalog pipeline (`generate-public-api-artifacts.mjs`) intentionally NOT run — see DEVIATION; `validate:public-api` + `validate:gateway-policy` stay green because no `flows` routing family is introduced. A black-box test (`flows-api-route-catalog.test.mjs`) gates the flat-catalog entries + privilege-domain split.

## 6. Tests — black-box and contract

> New black-box files (Temporal stubbed via injected fake client; in-memory store — no infra): `tests/blackbox/flows-api.test.mjs` (bbx-flows-api-01..17), `tests/blackbox/flows-api-isolation.test.mjs` (bbx-flows-iso-01..09), `tests/blackbox/flows-api-route-catalog.test.mjs` (bbx-flows-api-route-01..04) — 30 tests, all green (incl. the delete-409-while-active scenario, bbx-flows-api-17). Real-stack RLS: `tests/env/flows-api/{run.sh,flows-rls.test.mjs}` (9 tests, green against compose Postgres). Suites: blackbox 438 pass (was 408); unit 592; contracts 231; adapters 104; resilience 43; executor real-stack 63 — all unchanged from baseline except the +30 new blackbox.

- [x] 6.1 Write failing black-box tests in `tests/blackbox/` covering: create/get/update/delete flow definition, validate (pass + fail), publish, list versions, get version with YAML
- [x] 6.2 Write failing black-box tests for execution lifecycle: start, list, get detail, cancel, retry, signal
- [x] 6.3 Write cross-tenant probe tests: tenant A token against tenant B resource → 404 or 403, never data; for every route group (definitions, versions, executions)
- [x] 6.4 Write RLS real-stack test in `tests/env/`: direct-SQL probe confirms `falcone_app` cannot SELECT cross-tenant `flow_definitions` or `flow_versions` rows when RLS GUCs are set for a different tenant
- [x] 6.5 Write version-pinning test: start execution on v1, publish v2, assert v1 run reports original version in detail response
- [x] 6.6 Run `tests/blackbox/run.sh` with stub Temporal; confirm all new tests pass

## 7. CI quality gate

- [x] 7.1 Run contract, integration, and unit suites (CI `quality` job equivalent); fix any failures introduced by the server.mjs / main.mjs changes
- [x] 7.2 Confirm no regression in existing executor tests (postgres-data, DDL, mongo, events, functions, realtime, embedding)
