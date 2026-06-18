# control-plane-runtime Specification

## Purpose
TBD - created by archiving change add-control-plane-executor. Update Purpose after archive.
## Requirements
### Requirement: Deployed control-plane service SHALL answer gateway-routed requests

The system SHALL run a control-plane HTTP service on port 8080 such that APISIX routes targeting `upstreamService: control_api` receive a non-503 response, ending the current state where all `/v1/*` data-plane calls return 503 because no server is listening.

#### Scenario: Health probe returns 200 after deployment

- **WHEN** the control-plane Deployment is rolled out and the pod is Ready
- **THEN** a GET to `/healthz` on port 8080 returns HTTP 200 and the 503 condition on gateway-routed `/v1/*` requests is resolved

#### Scenario: Route is matched and dispatched rather than proxied to a dead socket

- **WHEN** a valid authenticated request for a known route (e.g. `GET /v1/workspaces/{workspaceId}/postgres/tables`) reaches the control-plane service via APISIX
- **THEN** the service returns a 2xx response and not a 503 or connection-refused error

### Requirement: Service SHALL authenticate requests from gateway-injected identity headers

The system SHALL read the trusted identity from the `X-Verified-Tenant-Id` and `X-Verified-Workspace-Id` headers injected by the `scope-enforcement` APISIX plugin, and reject any request that arrives without those headers or with an empty tenant identity.

#### Scenario: Request with valid injected identity is processed

- **WHEN** a request arrives at the control-plane with `X-Verified-Tenant-Id` and `X-Verified-Workspace-Id` populated by the gateway
- **THEN** the service extracts the tenant and workspace identities and proceeds to dispatch

#### Scenario: Request missing identity headers is rejected with 401

- **WHEN** a request arrives at the control-plane without the `X-Verified-Tenant-Id` header (bypassing the gateway or misconfigured upstream)
- **THEN** the service returns HTTP 401 with a machine-readable error code and does not attempt to dispatch the request

### Requirement: Service SHALL dispatch each route to the adapter plan-builder and execute the resulting plan

The system SHALL, for each matched route, call the corresponding adapter `build*Plan` function from `services/adapters/src/postgresql-data-api.mjs` to obtain a `{sql:{text,values}}` plan, then pass the plan to the per-backend executor which runs it against the real backend driver, so that adapter logic is reused and never reimplemented in the runtime.

#### Scenario: postgres-data list returns real rows end-to-end through the gateway

- **WHEN** an authenticated tenant issues `GET /v1/workspaces/{workspaceId}/postgres/{db}/tables` (or equivalent postgres-data list route)
- **THEN** the service calls `buildPostgresDataApiPlan` with `operation: "list"`, the executor runs the resulting SQL against the workspace Postgres connection via `pg`, and the response body contains the actual rows from the database

#### Scenario: postgres-data get returns a single real row

- **WHEN** an authenticated tenant issues the postgres-data get route for a specific row
- **THEN** the service calls `buildPostgresDataApiPlan` with `operation: "get"`, the executor runs the SQL, and the response body contains exactly the matching row or HTTP 404 if no row matches

#### Scenario: Adapter plan is executed — not returned raw

- **WHEN** the adapter plan-builder returns `{sql:{text,values}}`
- **THEN** the executor submits that query to a real `pg.Pool` and the HTTP response contains shaped row data, never the raw plan object

### Requirement: Service SHALL return 404 for unmatched routes

The system SHALL return HTTP 404 with a machine-readable error when the `(method, path)` pair does not match any entry in the loaded route table, so callers receive a deterministic not-found signal rather than an unhandled-route crash.

#### Scenario: Unknown route returns 404

- **WHEN** a request arrives for a method and path combination that is not present in the route table (e.g. `GET /v1/nonexistent/endpoint`)
- **THEN** the service returns HTTP 404 with `{"code":"NO_ROUTE","message":"..."}` and does not return 500 or crash the process

### Requirement: Backend errors SHALL be mapped to sanitized responses without stack-trace leakage

The system SHALL catch all errors from executor-layer operations (SQL failures, connection timeouts, constraint violations) and return a structured error response that includes a machine-readable error code and a safe message, without including a stack trace, raw SQL, or internal connection details in the response body.

#### Scenario: Postgres execution error returns a sanitized 502 and no stack trace

- **WHEN** the Postgres executor encounters a query error (e.g. relation does not exist, connection refused)
- **THEN** the service returns a 5xx response with a `code` field and a sanitized `message`, and the response body does not contain any stack trace text, SQL query text, or connection string

#### Scenario: Constraint violation returns a 4xx response without internal detail

- **WHEN** the Postgres executor encounters a unique-constraint or foreign-key violation
- **THEN** the service returns HTTP 409 or 422 with a structured body containing `code` and `message` and no raw Postgres error detail or query text

### Requirement: Dockerfile and Helm image wiring SHALL replace the placeholder

The system SHALL provide a Dockerfile (build context: repo root) that produces an image containing the server entrypoint, all executor modules, and the required adapter and internal-contracts packages, and the Helm chart `controlPlane.image` block SHALL be updated to reference the real image repository so that `helm upgrade` deploys a running service rather than the placeholder `ghcr.io/example/in-falcone-control-plane:0.1.0`.

#### Scenario: Helm-deployed image is the real control-plane server

- **WHEN** `helm upgrade` is run with the updated `charts/in-falcone/values.yaml`
- **THEN** the `controlPlane` Deployment uses the image built from `apps/control-plane/Dockerfile` and the pod starts and passes the readiness probe, replacing the previous placeholder image

### Requirement: Service SHALL accept and wire executor dependencies including the flows executor

The system SHALL extend `createControlPlaneServer` (`apps/control-plane/src/runtime/server.mjs::createControlPlaneServer`) to accept a `flowExecutor` parameter alongside the existing executor dependencies (`mongoExecutor`, `eventsExecutor`, `functionsExecutor`, `realtimeExecutor`, `pgRealtimeExecutor`, `embeddingExecutor`, `mappingStore`), and `buildRoutes` SHALL register the flows route family when a `flowExecutor` is provided. `main.mjs` SHALL instantiate `flow-executor.mjs` and pass it to `createControlPlaneServer`. When no `flowExecutor` is provided, flows routes MUST NOT be registered and any request to a flows path MUST fall through to the existing 404 / upstream-proxy path unchanged.

#### Scenario: Server starts and registers flows routes when flowExecutor is injected
- **WHEN** `main.mjs` instantiates `flow-executor.mjs` and passes it as `flowExecutor` to `createControlPlaneServer`
- **THEN** `buildRoutes` includes the `flows` family route tuples and a `GET /healthz` probe on the running server still returns HTTP 200

#### Scenario: Server omits flows routes when flowExecutor is absent
- **WHEN** `createControlPlaneServer` is called without a `flowExecutor` parameter (or with `undefined`)
- **THEN** `GET /v1/flows/workspaces/{workspaceId}/flows` returns HTTP 404 (or is proxied upstream if `controlPlaneUpstream` is set), and no flows route tuple appears in the route table

#### Scenario: Existing executor routes are unaffected by the addition of flowExecutor
- **WHEN** `createControlPlaneServer` is initialised with a `flowExecutor` alongside existing executors
- **THEN** all previously registered routes (postgres-data, DDL, mongo, events, functions, realtime, embedding) continue to match and respond correctly

### Requirement: cp-executor cannot reach FerretDB (NetworkPolicy label mismatch)

The system SHALL ensure that cp-executor cannot reach FerretDB (NetworkPolicy label mismatch) is corrected: Set `app.kubernetes.io/name: control-plane-executor` on the executor pod template; align the chart `controlPlaneExecutor` labels with the NetworkPolicy contract.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Executor mongo CRUD 2xx on a clean deploy

### Requirement: Governance schema incomplete (capability-catalog / plan-assignment / scope-audit 500)

The system SHALL ensure that governance schema incomplete (capability-catalog / plan-assignment / scope-audit 500) is corrected: Ensure the control-plane schema bootstrap creates+seeds the full governance schema (or the bootstrap Job runs the governance migrations) so all provisioning-orchestrator actions resolve.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The four endpoints return 200

### Requirement: Install runs stale node-cached images (tag reuse + IfNotPresent)

The system SHALL ensure that install runs stale node-cached images (tag reuse + IfNotPresent) is corrected: Use unique per-build tags (or `imagePullPolicy: Always`) in install.sh/executor-demo.yaml/values; drop the gateway-secret pre-create (chart owns it).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A rebuild always runs the new code on the next deploy

### Requirement: Single-workspace cascading teardown API

The system SHALL expose `DELETE /v1/workspaces/{workspaceId}` that tears down everything a single
workspace owns — its per-workspace `wsdb_*` database, its bucket(s), its Kafka topic(s), and its
registry rows (workspace + service-account / api-key / database / bucket / topic / function rows) —
the per-workspace counterpart of the tenant purge cascade. Physical teardown (database drop, bucket
and topic deletion) SHALL be best-effort (failures are tolerated and the removed resources are
reported); registry-row teardown SHALL be reliable so no orphaned rows remain.

The teardown SHALL be tenant-scoped: the workspace is resolved first, then the caller's ownership is
gated from the verified identity — a tenant owner/admin MAY delete ONLY a workspace whose
`tenant_id` matches their identity; superadmin/internal MAY delete any workspace. A request for a
workspace owned by another tenant (or a non-existent workspace) SHALL be rejected with `404` and
SHALL perform NO teardown (no existence leak). The shippable product (`apps/control-plane`) SHALL
provide the equivalent ownership-gated handler wired to the existing public route `deleteWorkspace`.

#### Scenario: owner deletes own workspace with full cascade

- **WHEN** a tenant owner issues `DELETE /v1/workspaces/{workspaceId}` for a workspace their tenant owns
- **THEN** the response is `200`, the workspace's `wsdb_*` database is dropped, its bucket(s) and
  topic(s) are deleted, and the workspace + its child registry rows are removed

#### Scenario: cross-tenant deletion is denied with no teardown

- **WHEN** a tenant owner issues `DELETE /v1/workspaces/{workspaceId}` for a workspace owned by a different tenant
- **THEN** the response is `404` (no existence leak) and NO database/bucket/topic or registry-row teardown is performed

#### Scenario: superadmin deletes any workspace

- **WHEN** a superadmin/internal caller issues `DELETE /v1/workspaces/{workspaceId}` for any tenant's workspace
- **THEN** the response is `200` and the full per-workspace cascade runs

#### Scenario: physical teardown is best-effort

- **WHEN** the workspace is deleted but the physical database/bucket/topic teardown fails
- **THEN** the response is still `200`, the registry rows are still removed, and no orphaned rows remain

### Requirement: Vault is out-of-scope (opt-out) on the kind/campaign profile

The system SHALL keep Vault DISABLED on the kind/campaign deployment profile, because cert-manager is
absent on that cluster (enabling Vault renders a `cert-manager.io/v1` resource that aborts the
release) and no Falcone component reads secrets FROM Vault (every component reads native Kubernetes
Secrets). Enabling Vault SHALL be a deliberate, separate decision (an explicit values opt-in), and
rendering the chart on the kind profile SHALL produce no Vault workload and no cert-manager resource.

#### Scenario: kind/campaign profile keeps Vault disabled

- **WHEN** the chart is rendered with the kind/campaign values
- **THEN** `vault.enabled` is `false`, no Vault server workload renders, and no `cert-manager.io/v1` resource renders

### Requirement: Widened Prometheus scrape coverage

The system SHALL widen the Prometheus scrape configuration beyond the three static targets
(control-plane, cp-executor, APISIX) to cover any Falcone component that exposes a Prometheus
`/metrics` endpoint, via a namespace-scoped Kubernetes pod service-discovery scrape job that selects
pods annotated `prometheus.io/scrape: "true"` and reads their metrics port/path from
`prometheus.io/port` / `prometheus.io/path`. Components that expose `/metrics` (control-plane,
cp-executor) SHALL carry the scrape annotation; components without a `/metrics` endpoint (e.g.
workflow-worker, which serves only `/livez` + `/readyz`) SHALL NOT be annotated and SHALL NOT be
scraped. The discovery SHALL be scoped to the release namespace only.

#### Scenario: scrape config covers metrics-exposing components, not just three static targets

- **WHEN** the chart's Prometheus ConfigMap is rendered
- **THEN** it retains the control-plane, cp-executor, and APISIX targets AND adds a namespace-scoped
  Kubernetes pod-discovery job keyed on the `prometheus.io/scrape` annotation, and the
  metrics-exposing components are annotated while workflow-worker (no `/metrics`) is not

