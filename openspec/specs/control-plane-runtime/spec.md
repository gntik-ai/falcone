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

