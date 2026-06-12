## 1. Baseline and pre-flight

- [ ] 1.1 Confirm baseline green: run `tests/blackbox/run.sh` and CI `quality` job; record pass/fail state before any code change
- [ ] 1.2 Verify `TEMPORAL_ADDRESS` env var convention with #356 (Temporal client connection model) and record the agreed env var names in design.md OQ2

## 2. Database migrations

- [ ] 2.1 Write idempotent migration for `flow_definitions` table (`tenant_id`, `workspace_id`, `flow_id`, `name`, `definition_yaml`, `definition_json`, `dsl_api_version`, `status`, `created_by`, `created_at`, `updated_at`); primary key `flow_id`; unique on `(tenant_id, workspace_id, flow_id)`
- [ ] 2.2 Write idempotent migration for `flow_versions` table (`tenant_id`, `workspace_id`, `flow_id`, `version`, `definition_yaml`, `definition_json`, `dsl_api_version`, `created_by`, `created_at`); primary key `(flow_id, version)`
- [ ] 2.3 Add RLS migration for both tables: `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, policy using `current_setting('app.tenant_id', true)` + `current_setting('app.workspace_id', true)`; `GRANT SELECT, INSERT, UPDATE, DELETE ON flow_definitions TO falcone_app`; `GRANT SELECT, INSERT ON flow_versions TO falcone_app` (no UPDATE/DELETE per D6)
- [ ] 2.4 Verify migration idempotency: run twice against a local Postgres; confirm no error on re-run

## 3. Flow executor module

- [ ] 3.1 Create `apps/control-plane/src/runtime/flow-executor.mjs` exporting `createFlowExecutor({ temporalAddress, temporalNamespace, logger })`; hold the sole `@temporalio/client` `Connection` and `WorkflowClient` instance
- [ ] 3.2 Implement `executeFlows({ operation, tenantId, workspaceId, flowId, ... })` dispatch function handling all operations: `create_definition`, `list_definitions`, `get_definition`, `update_definition`, `delete_definition`, `validate`, `publish_version`, `list_versions`, `get_version`, `start_execution`, `list_executions`, `get_execution`, `cancel_execution`, `retry_execution`, `send_signal`
- [ ] 3.3 Implement server-side workflow ID generation: `${tenantId}:${workspaceId}:${flowId}:${crypto.randomUUID()}`; add a `parseWorkflowId` helper that validates the prefix matches `${identity.tenantId}:`
- [ ] 3.4 Implement Temporal search-attribute injection on `start_execution` (per #356 model: `tenantId`, `workspaceId`, `flowId`, `flowVersion` as typed search attributes)
- [ ] 3.5 Implement execution list via Temporal visibility query; mandatory `tenantId` filter injected server-side; map response to public execution shape
- [ ] 3.6 Implement cancel, retry (new run from same version + input), and signal (with `signalName` validation against published DSL version's signal definitions)
- [ ] 3.7 Return HTTP 503 with `code: TEMPORAL_UNAVAILABLE` when the Temporal client is disconnected; use lazy-connect pattern (connect on first use)

## 4. Server wiring

- [ ] 4.1 Extend `buildRoutes()` signature in `server.mjs` to accept `flowExecutor`; add flows route tuples when `flowExecutor` is defined, using prefix `const fl = '^/v1/flows/workspaces/([^/]+)'`
- [ ] 4.2 Add the following route tuples (method, RegExp, handler) inside `buildRoutes`:
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
- [ ] 4.3 Extend `createControlPlaneServer` destructured parameter to include `flowExecutor`; thread it into `buildRoutes()` call
- [ ] 4.4 Update `main.mjs`: import `createFlowExecutor`; conditionally instantiate when `TEMPORAL_ADDRESS` is set; pass to `createControlPlaneServer`; call `flowExecutor?.close()` in `shutdown()`

## 5. Public route catalog

- [ ] 5.1 Add all 15 flows route entries to `services/internal-contracts/src/public-route-catalog.json` following the existing entry shape; set `family: "flows"`, `scope: "workspace"`, `downstreamService: "control_api"`, `tenantBinding: "required"`, `workspaceBinding: "required"`, `visibility: "public"`
- [ ] 5.2 Set `gatewayRouteClass: "control"` on definition-management routes (CRUD, validate, publish, version list/get) and `gatewayRouteClass: "data-control"` on execution routes (start, list, detail, cancel, retry, signal)
- [ ] 5.3 Run `node scripts/generate-public-api-artifacts.mjs`; commit the regenerated artifacts alongside the catalog change

## 6. Tests — black-box and contract

- [ ] 6.1 Write failing black-box tests in `tests/blackbox/` covering: create/get/update/delete flow definition, validate (pass + fail), publish, list versions, get version with YAML
- [ ] 6.2 Write failing black-box tests for execution lifecycle: start, list, get detail, cancel, retry, signal
- [ ] 6.3 Write cross-tenant probe tests: tenant A token against tenant B resource → 404 or 403, never data; for every route group (definitions, versions, executions)
- [ ] 6.4 Write RLS real-stack test in `tests/env/`: direct-SQL probe confirms `falcone_app` cannot SELECT cross-tenant `flow_definitions` or `flow_versions` rows when RLS GUCs are set for a different tenant
- [ ] 6.5 Write version-pinning test: start execution on v1, publish v2, assert v1 run reports original version in detail response
- [ ] 6.6 Run `tests/blackbox/run.sh` with stub Temporal; confirm all new tests pass

## 7. CI quality gate

- [ ] 7.1 Run contract, integration, and unit suites (CI `quality` job equivalent); fix any failures introduced by the server.mjs / main.mjs changes
- [ ] 7.2 Confirm no regression in existing executor tests (postgres-data, DDL, mongo, events, functions, realtime, embedding)
