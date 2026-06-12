## ADDED Requirements

### Requirement: Flow definitions SHALL be created, retrieved, updated, and deleted as draft heads per workspace

The system SHALL expose CRUD operations for flow definitions (draft head state) under `/v1/flows/workspaces/{workspaceId}/flows`, scoped to the authenticated tenant via `resolveIdentity` (`apps/control-plane/src/runtime/server.mjs::resolveIdentity`). The `tenant_id` and `workspace_id` are derived exclusively from the verified credential; request bodies MUST NOT supply them. The `flow_definitions` Postgres table SHALL have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with a policy equivalent to `services/scheduling-engine/migrations/002-rls-scheduling-tables.sql`.

#### Scenario: Create a new flow definition
- **WHEN** an authenticated tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows` with a valid `name` and optional `definition_yaml`
- **THEN** the system persists a new row in `flow_definitions` keyed by `(tenant_id, workspace_id, flow_id)`, returns HTTP 201 with the created resource, and the row is inaccessible to any other tenant under `falcone_app` role

#### Scenario: List flow definitions returns only the requesting tenant's flows
- **WHEN** an authenticated tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows`
- **THEN** the response contains only flows belonging to that tenant's workspace, and rows from other tenants are never included in the result set

#### Scenario: Get a specific flow definition
- **WHEN** an authenticated tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}`
- **THEN** the system returns HTTP 200 with the draft head definition if it belongs to the tenant, or HTTP 404 if it does not exist or belongs to another tenant

#### Scenario: Update a flow definition draft
- **WHEN** an authenticated tenant sends `PATCH /v1/flows/workspaces/{workspaceId}/flows/{flowId}` with updated fields
- **THEN** the system updates only the draft head row, returns HTTP 200, and does not affect any published version rows in `flow_versions`

#### Scenario: Delete a flow definition
- **WHEN** an authenticated tenant sends `DELETE /v1/flows/workspaces/{workspaceId}/flows/{flowId}`
- **THEN** the system removes the draft head row and returns HTTP 200; the operation is rejected with HTTP 409 if there are active (non-terminal) executions referencing the flow

#### Scenario: Cross-tenant CRUD probe returns 404
- **WHEN** a tenant uses their valid token to request `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}` where `flowId` belongs to a different tenant's workspace
- **THEN** the system returns HTTP 404 and no flow data is disclosed

### Requirement: Flow validate SHALL return 422 with node-scoped error codes on invalid definitions

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/validate` which runs JSON Schema validation plus semantic rules (from #358) against the stored draft and returns a structured error envelope when validation fails. Each error entry SHALL include a `nodeId` identifying the offending DSL node and a machine-readable `code`. The endpoint SHALL return HTTP 200 when validation passes.

#### Scenario: Invalid YAML triggers 422 with node-scoped errors
- **WHEN** a tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/validate` and the stored draft contains a node that violates the JSON Schema
- **THEN** the system returns HTTP 422 with `{"errors":[{"nodeId":"<id>","code":"<ERROR_CODE>","message":"..."},...]}` and does not create any version

#### Scenario: Valid definition returns 200 with no errors
- **WHEN** a tenant sends the validate request and the stored draft satisfies all schema and semantic rules
- **THEN** the system returns HTTP 200 with `{"valid":true}`

#### Scenario: Validate does not mutate state
- **WHEN** the validate endpoint is called regardless of outcome
- **THEN** no `flow_versions` row is created and the `flow_definitions` draft head is unchanged

### Requirement: Flow publish SHALL freeze an immutable version and leave in-flight executions unaffected

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` which validates the current draft, persists an immutable row in `flow_versions` (`tenant_id`, `workspace_id`, `flow_id`, `version`, `definition_yaml`, `definition_json`, `dsl_api_version`, `created_by`, `created_at`), and returns HTTP 201. Published version rows SHALL be immutable: no UPDATE or DELETE is permitted by `falcone_app`. The `flow_versions` table SHALL have `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` with a tenant-and-workspace-scoped policy. Version numbers SHALL be assigned monotonically by the server.

#### Scenario: Publish succeeds for a valid draft
- **WHEN** a tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` and the draft passes validation
- **THEN** the system creates a new row in `flow_versions`, returns HTTP 201 with `{"version": N, "flowId": "..."}`, and the draft head remains editable

#### Scenario: Publish fails with 422 for an invalid draft
- **WHEN** a tenant sends the publish request and the current draft fails validation
- **THEN** the system returns HTTP 422 with node-scoped error codes and no version row is created

#### Scenario: Published version is immutable
- **WHEN** a second publish creates version 2 for the same flow
- **THEN** the version 1 row in `flow_versions` is unchanged and the `falcone_app` role cannot UPDATE or DELETE it

#### Scenario: In-flight executions on version 1 are unaffected by publishing version 2
- **WHEN** an execution started on version 1 is still running and a tenant publishes version 2
- **THEN** the running execution continues to use the version 1 definition and the Temporal workflow is not interrupted

### Requirement: Flow versions SHALL be listable and retrievable including the stored YAML

The system SHALL expose `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions` (paginated list) and `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions/{version}` (single version, including `definition_yaml` for the console editor). Both endpoints are scoped by the tenant identity from `resolveIdentity`.

#### Scenario: List versions returns all published versions for the requesting tenant
- **WHEN** a tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions`
- **THEN** the response lists all published versions for that flow in ascending version order, and versions from other tenants are never included

#### Scenario: Get version includes the YAML definition
- **WHEN** a tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/versions/{version}`
- **THEN** the response body includes `definition_yaml` so the console editor can reconstruct the flow

#### Scenario: Get version for another tenant returns 404
- **WHEN** a tenant requests a version that exists but belongs to a different tenant
- **THEN** the system returns HTTP 404 and no definition data is disclosed

### Requirement: Flow executions SHALL be started pinned to a specific version

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` to start a new execution. The request body SHALL include a `version` (or default to latest published). The `flow-executor.mjs` module SHALL be the sole component constructing and submitting a Temporal workflow start request. The workflow ID SHALL be server-generated as `{tenantId}:{workspaceId}:{flowId}:{runUuid}` and MUST NOT be accepted from the client. Tenant context SHALL be injected as Temporal search attributes per the #356 model.

#### Scenario: Start execution returns 201 with the run reference
- **WHEN** a tenant sends `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` with a valid `version` (or none, defaulting to latest)
- **THEN** the system starts a Temporal workflow, returns HTTP 201 with `{"executionId":"...","workflowId":"...","runId":"...","version":N}`, and the workflow ID matches `{tenantId}:{workspaceId}:{flowId}:{runUuid}`

#### Scenario: Workflow ID is never accepted from the client
- **WHEN** a tenant sends a start execution request with a `workflowId` field in the request body
- **THEN** the system ignores the client-supplied value and generates the canonical ID server-side; the returned `workflowId` matches the server pattern

#### Scenario: Start with a non-existent version returns 404
- **WHEN** a tenant requests execution with a `version` that has no corresponding row in `flow_versions` for that flow
- **THEN** the system returns HTTP 404 without submitting anything to Temporal

### Requirement: Flow execution list SHALL use Temporal visibility search attributes to scope results to the tenant

The system SHALL expose `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions` which queries Temporal visibility using search attribute filters: `tenantId` and `workspaceId` (mandatory), plus optional `flowVersion` and `status`. The search attribute filter MUST always include `tenantId` equal to the identity's `tenantId`; the value MUST NOT be overridable by query parameters.

#### Scenario: List executions returns only the requesting tenant's runs
- **WHEN** a tenant sends `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions`
- **THEN** the Temporal visibility query includes `tenantId = '<tenantId>'` as a non-overridable filter and the response contains only that tenant's workflow runs

#### Scenario: Status filter narrows results
- **WHEN** a tenant sends the list request with `?status=Running`
- **THEN** the Temporal visibility query includes the status filter and only running executions are returned

#### Scenario: Cross-tenant execution list probe returns empty
- **WHEN** a tenant uses their valid token but specifies another tenant's `workspaceId` in the path
- **THEN** the system enforces the identity-derived `tenantId` in the Temporal query and returns an empty list or 404, never exposing the other tenant's runs

### Requirement: Flow execution detail SHALL map Temporal history events to DSL node IDs

The system SHALL expose `GET /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}` which fetches Temporal workflow execution history and maps activity/signal events to DSL node IDs using the naming convention from #359. The response SHALL include `status`, `startedAt`, `closedAt`, `input`, `result`, and an `events` array with `nodeId` fields.

#### Scenario: Get execution detail returns mapped events
- **WHEN** a tenant sends a get-detail request for a running or completed execution belonging to their workspace
- **THEN** the response includes an `events` array where each entry has a `nodeId` matching the DSL node naming convention from #359

#### Scenario: Get execution detail for another tenant returns 404
- **WHEN** a tenant requests execution detail where the `workflowId` prefix does not match `{identity.tenantId}:…`
- **THEN** the system returns HTTP 404 without fetching Temporal history

### Requirement: Flow executions SHALL be cancellable and retryable by the owning tenant

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/cancellations` (cancel) and `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/retries` (retry as a new run from the same version and input). Both operations MUST verify that the workflow ID prefix matches `{identity.tenantId}:` before submitting any Temporal command.

#### Scenario: Cancel a running execution
- **WHEN** a tenant sends `POST …/executions/{executionId}/cancellations` for an execution in Running state
- **THEN** the system sends a Temporal cancel request, returns HTTP 202, and the workflow transitions to Cancelled

#### Scenario: Cancel for another tenant's execution returns 403
- **WHEN** a tenant attempts to cancel an execution whose workflow ID prefix does not match their `tenantId`
- **THEN** the system returns HTTP 403 without sending any Temporal command

#### Scenario: Retry creates a new run pinned to the same version and input
- **WHEN** a tenant sends `POST …/executions/{executionId}/retries`
- **THEN** the system starts a new Temporal workflow with the same version and input as the original run, returns HTTP 201 with the new `executionId`, and the original run is unaffected

### Requirement: Human-approval signals SHALL be deliverable to running executions by the owning tenant

The system SHALL expose `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions/{executionId}/signals/{signalName}` to send a named signal (e.g., `human-approval`) to a running workflow. The `signalName` SHALL be validated against an allowlist derived from the DSL definition before being forwarded to Temporal. The operation MUST verify the `{tenantId}:` prefix of the workflow ID.

#### Scenario: Send a human-approval signal to a waiting execution
- **WHEN** a tenant sends `POST …/executions/{executionId}/signals/human-approval` with a valid `payload`
- **THEN** the system delivers the signal to the Temporal workflow via `flow-executor.mjs`, returns HTTP 202, and the workflow resumes

#### Scenario: Signal to another tenant's execution returns 403
- **WHEN** a tenant sends a signal request for an execution whose workflow ID prefix does not match their `tenantId`
- **THEN** the system returns HTTP 403 without sending any Temporal signal

#### Scenario: Unknown signal name returns 422
- **WHEN** a tenant sends a signal whose `signalName` is not present in the published DSL version's signal definitions
- **THEN** the system returns HTTP 422 with `{"code":"UNKNOWN_SIGNAL","message":"..."}` and does not forward the signal to Temporal

### Requirement: All flows routes SHALL be registered in the public route catalog with correct scope classes

The system SHALL add entries for every flows route to `services/internal-contracts/src/public-route-catalog.json` with `family: "flows"`, `scope: "workspace"`, `downstreamService: "control_api"`, `tenantBinding: "required"`, `workspaceBinding: "required"`, and `visibility: "public"`. Definition management routes (CRUD, validate, publish, versions) SHALL use `gatewayRouteClass: "control"`. Execution routes (start, list, detail, cancel, retry, signal) SHALL use `gatewayRouteClass: "data-control"`. Regenerated artifacts (`scripts/generate-public-api-artifacts.mjs`) SHALL be committed alongside the catalog change.

#### Scenario: Route catalog entries are present after catalog update
- **WHEN** `scripts/generate-public-api-artifacts.mjs` is run after adding the flows routes to the catalog
- **THEN** the generated artifacts include the `flows` family and all route entries are present with correct fields

#### Scenario: Definition-management routes use control class
- **WHEN** examining the catalog entry for `POST /v1/flows/workspaces/{workspaceId}/flows`
- **THEN** `gatewayRouteClass` is `"control"` and `tenantBinding` is `"required"`

#### Scenario: Execution routes use data-control class
- **WHEN** examining the catalog entry for `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/executions`
- **THEN** `gatewayRouteClass` is `"data-control"` and `tenantBinding` is `"required"`
