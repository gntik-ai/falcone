## ADDED Requirements

### Requirement: Tenancy model enforced on every Temporal operation

The system SHALL verify the caller's `tenantId` and `workspaceId` (resolved exclusively via `resolveIdentity` from the API key or JWT, never from client-supplied request body fields) against the Temporal execution or visibility record before completing any describe, history, signal, cancel, or list operation. When the shared-namespace model is in use, the system SHALL stamp `tenantId` and `workspaceId` as Temporal search attributes at execution start server-side and include a mandatory filter on both attributes in every visibility query. When the namespace-per-tenant model is in use, the system SHALL route all Temporal calls for a tenant to that tenant's dedicated namespace and SHALL reject calls whose workflow ID does not begin with the `{tenantId}:` prefix.

#### Scenario: Tenant A cannot read Tenant B's execution via direct workflow ID

- **WHEN** tenant A's authenticated request includes a `workflowId` that was started by tenant B
- **THEN** the system MUST return HTTP 404 and MUST NOT include any tenant-B data in the response body

#### Scenario: Visibility query cannot be escaped by injecting extra search-attribute filters

- **WHEN** tenant A sends a list-executions request with crafted filter parameters that attempt to remove or override the server-injected `tenantId` search-attribute filter
- **THEN** the system MUST ignore the crafted filter fields, apply its own `tenantId = callerTenantId` constraint, and return only tenant A's executions

#### Scenario: Signal endpoint rejects forged workflow ID

- **WHEN** a request arrives at the signal or cancel endpoint with a `workflowId` whose embedded `tenantId` prefix does not match the caller's authenticated `tenantId`
- **THEN** the system MUST return HTTP 404 without forwarding the call to Temporal

#### Scenario: Task-queue naming prevents cross-tenant task pickup

- **WHEN** the workflow worker polls for tasks on a task queue derived from the tenant or namespace strategy chosen by the ADR
- **THEN** a worker bound to tenant A's task queue or namespace MUST NOT dequeue or execute activities belonging to tenant B

### Requirement: Workflow IDs are generated server-side and scoped to tenant

The system SHALL generate workflow IDs in the form `{tenantId}:{workspaceId}:{flowId}:{runUuid}` exclusively on the server; clients MUST NOT be able to supply, predict, or override a workflow ID in any execution-start request.

#### Scenario: Client-supplied workflowId is rejected at execution start

- **WHEN** a client submits an execution-start request that includes a `workflowId` field in the request body
- **THEN** the system MUST ignore the client-supplied value, generate its own namespaced workflow ID, and proceed using the server-generated ID

#### Scenario: Server-generated workflow ID contains the caller's tenantId

- **WHEN** the system starts an execution for tenant A workspace W and flow F
- **THEN** the resulting workflow ID MUST begin with `{tenantA}:{W}:{F}:` followed by a run-unique UUID suffix

### Requirement: Per-execution credentials are scoped to tenant and workspace and expire with the run

The system SHALL mint a short-lived service token for each execution start, scoped to exactly `{ tenantId, workspaceId }` of the triggering identity, carry it via Temporal headers or payload context, and ensure the token expiry does not outlast the maximum allowed flow run duration. Activities MUST validate the token before accessing any tenant data; a missing or expired token MUST cause the activity to fail with a non-retryable error.

#### Scenario: Token scope matches execution tenant and workspace

- **WHEN** a flow execution is started for tenant A workspace W
- **THEN** the per-execution token in the Temporal payload context MUST carry `tenantId = A` and `workspaceId = W` with no other tenants' identifiers

#### Scenario: Expired per-execution token causes activity failure

- **WHEN** an activity receives a Temporal payload context whose embedded token has passed its `expiresAt` timestamp
- **THEN** the activity MUST fail with error code `EXECUTION_TOKEN_EXPIRED` and MUST NOT access any tenant data store

#### Scenario: Token from a different tenant is rejected by activity

- **WHEN** an activity receives a token whose `tenantId` does not match the `tenantId` search attribute stamped on the workflow execution
- **THEN** the activity MUST fail with error code `EXECUTION_TOKEN_TENANT_MISMATCH` and MUST NOT process the task

### Requirement: Per-tenant and per-workspace quota dimensions limit flow resource consumption

The system SHALL enforce five quota dimensions for the `workflows` capability using the existing `quota-enforce` action: `max_flows` (stored flow definitions per tenant), `max_flow_versions` (published versions per flow), `max_concurrent_executions` (running executions per workspace), `flow_starts_per_minute` (execution start rate per workspace), and `flow_signal_rate_per_minute` (signal calls per workspace per minute). Exceeding a hard limit MUST result in HTTP 429 with a body indicating the breached dimension. One tenant saturating any quota dimension MUST NOT reduce throughput or increase latency for another tenant's flow operations.

#### Scenario: Exceeding concurrent-execution hard limit returns 429

- **WHEN** a workspace has reached its `max_concurrent_executions` hard limit and a new execution-start request arrives
- **THEN** the system MUST return HTTP 429 with `code: "QUOTA_EXCEEDED"` and `dimension: "max_concurrent_executions"` in the response body and MUST NOT start a new Temporal workflow

#### Scenario: Tenant A saturating start rate does not delay Tenant B

- **WHEN** tenant A has exhausted its `flow_starts_per_minute` quota and is receiving 429 responses
- **THEN** a concurrent execution-start request from tenant B with quota headroom MUST complete within normal latency bounds and MUST NOT be affected by tenant A's rate state

#### Scenario: Quota enforcement is consistent with existing quota-plans capability conventions

- **WHEN** a platform operator calls the quota effective-limits endpoint for a tenant's workspace with dimension key `max_concurrent_executions`
- **THEN** the response MUST include `effectiveLimit`, `quotaType`, `source`, and `currentUsage` fields in the same structure returned by existing quota dimensions such as `max_functions`

### Requirement: All flow lifecycle actions emit tenant-scoped audit events

The system SHALL emit an audit event to the existing audit pipeline for each of the following actions: flow definition created, flow definition updated, flow version published, flow definition deleted, execution started, execution cancelled, execution retry triggered, and signal sent. Every audit event MUST carry `tenantId`, `workspaceId`, `actorId`, `flowId`, `flowVersion` (where applicable), and `occurredAt` as non-nullable fields.

#### Scenario: Flow publish emits audit event with correct tenant context

- **WHEN** an authenticated user from tenant A workspace W publishes flow F as version V
- **THEN** the audit pipeline MUST receive an event with `eventType: "flow.version_published"`, `tenantId = A`, `workspaceId = W`, `flowId = F`, `flowVersion = V`, and `actorId` matching the authenticated identity

#### Scenario: Execution-start audit event contains all required fields

- **WHEN** an execution of flow F version V is started by actor U in tenant A workspace W
- **THEN** the audit pipeline MUST receive an event with `eventType: "flow.execution_started"`, `tenantId = A`, `workspaceId = W`, `flowId = F`, `flowVersion = V`, `actorId = U`, and a non-null `occurredAt` timestamp

#### Scenario: Signal audit event is tenant-scoped

- **WHEN** actor U from tenant A sends a signal to a running execution of tenant A's flow F
- **THEN** the audit pipeline MUST receive an event with `eventType: "flow.signal_sent"` carrying `tenantId = A` and `actorId = U`

### Requirement: Tenant deletion cascades to all workflows domain resources with no orphans

The system SHALL add a `workflows` domain entry to the `TEARDOWN_PLAN` in `tenant-purge-sweep.mjs` so that when a tenant is purged, all flow definitions, flow versions, schedules, and (per tenancy model) the Temporal namespace or all workflow executions owned by that tenant are removed. The teardown step MUST be idempotent and MUST follow the same partial-failure semantics as the existing six domain teardowns: on error the purge is NOT finalized, `purge.failed` is emitted, and the sweep is retried.

#### Scenario: Tenant purge removes all flow definitions and versions

- **WHEN** a tenant transitions to `state='purged'` and the `TEARDOWN_PLAN` workflows step executes
- **THEN** no `flow_definitions` or `flow_versions` rows for that tenant MUST remain in the database after the step completes successfully

#### Scenario: Temporal namespace or executions are removed on tenant purge

- **WHEN** the workflows teardown applier runs for a purged tenant
- **THEN** either the dedicated Temporal namespace is deleted (namespace-per-tenant model) or all workflow executions with `tenantId` matching the purged tenant are terminated and removed from visibility (shared-namespace model); no orphaned Temporal state remains

#### Scenario: Workflows teardown failure blocks finalization and emits purge.failed

- **WHEN** the workflows domain teardown step encounters an error during tenant purge
- **THEN** the system MUST NOT hard-delete service rows, MUST NOT transition the tenant to `state='purged'`, MUST emit `purge.failed` with `failedDomain: "workflows"`, and MUST leave the sweep eligible for retry

### Requirement: Cross-tenant isolation probe suite covers all flows routes and execution paths

The system SHALL include a black-box two-tenant probe suite (tenant A and tenant B provisioned as separate fixtures) that exercises every flows API route and execution observation path and asserts that every cross-tenant access attempt returns HTTP 404 or 403 with zero tenant data leakage in response bodies or error messages. The suite MUST include probes for: list flows, get flow, start execution, get execution detail, list executions, cancel execution, retry execution, send signal, get execution history, and observation/streaming endpoints if any.

#### Scenario: Tenant A cannot list Tenant B's flow definitions

- **WHEN** an authenticated request from tenant A targets the list-flows endpoint with tenant B's workspace ID
- **THEN** the system MUST return HTTP 403 or 404 and the response body MUST NOT contain any flow definition belonging to tenant B

#### Scenario: Tenant A cannot observe Tenant B's execution history

- **WHEN** tenant A sends a get-execution-history request using a workflow ID belonging to tenant B
- **THEN** the system MUST return HTTP 404 and MUST NOT include any event entries from tenant B's execution history

#### Scenario: Forged workflow ID with wrong tenant prefix returns 404

- **WHEN** a request arrives with a workflow ID whose `{tenantId}:` prefix does not match the caller's authenticated `tenantId`
- **THEN** the system MUST return HTTP 404 without making any Temporal API call
