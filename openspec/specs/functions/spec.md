# functions Specification

## Purpose
TBD - created by archiving change add-functions-execute. Update Purpose after archive.
## Requirements
### Requirement: Deploy and invoke execute via the backend and record an activation

The system SHALL execute `deploy` and `invoke` requests against the configured backend
so that a deployed function is callable and each invocation produces an activation record
containing the result, captured logs, and a timestamp.

#### Scenario: Deploy then invoke returns result and logs

- **WHEN** a caller with a valid workspace identity deploys a function via
  `POST /v1/functions/workspaces/{wid}/actions` with a source that returns a value and
  emits console output, then invokes it via
  `POST /v1/functions/workspaces/{wid}/actions/{name}/invocations`
- **THEN** the invocation response contains `result`, `logs` with the captured output,
  and `status: "success"`; an activation record for that invocation is stored and
  retrievable via `GET .../actions/{name}/activations`

### Requirement: Functions and activations are tenant-scoped by workspace

The system SHALL scope all function and activation data to the calling workspace so that
a function deployed in workspace A is not visible or invocable from workspace B.

#### Scenario: Function in workspace A is not visible from workspace B

- **WHEN** workspace A deploys a function named `greet` and workspace B calls
  `GET /v1/functions/workspaces/{widB}/actions/greet`
- **THEN** the response status is 404 and workspace B's list of actions does not contain
  `greet`

#### Scenario: Workspace B cannot invoke workspace A's function

- **WHEN** workspace A deploys a function and workspace B posts an invocation using
  workspace A's action name under workspace B's path
- **THEN** the response status is 404 and no activation is recorded in workspace A

### Requirement: A failing function returns a sanitized error status, not 5xx

The system SHALL return a response with `status: "error"` and a sanitized `error` field
when the invoked function throws an exception, so that caller-induced function failures
do not produce HTTP 5xx responses and raw stack traces are not leaked.

#### Scenario: Throwing function returns error status without 5xx

- **WHEN** a caller invokes a deployed function whose source throws an exception
- **THEN** the HTTP response status is 200, the body contains `status: "error"`, and the
  `error` field contains only the exception message without internal stack frames or
  file paths

### Requirement: A runaway invocation is bounded by the executor timeout

The system SHALL terminate any invocation that exceeds the configured timeout and return
a response with `status: "timeout"` so that long-running or infinite-loop functions
cannot block server resources indefinitely.

#### Scenario: Infinite-loop function is killed and returns timeout status

- **WHEN** a caller invokes a deployed function whose source contains an infinite loop
- **THEN** the invocation completes within the timeout window, the HTTP response status
  is 200, and the body contains `status: "timeout"`

### Requirement: List does not leak function source

The system SHALL omit the `source` field from every item in the `list` response so that
function source code is not exposed to callers who have list access.

#### Scenario: List response contains no source field

- **WHEN** a caller lists functions via
  `GET /v1/functions/workspaces/{wid}/actions` after deploying at least one function
- **THEN** none of the returned items contains a `source` field

### Requirement: Missing workspace identity returns 401

The system SHALL return HTTP 401 for any functions request that arrives without a
resolvable tenant identity (no `x-tenant-id` header and no valid API key), so that
unauthenticated callers cannot deploy, invoke, or list functions.

#### Scenario: Request with no identity is rejected with 401

- **WHEN** a caller sends a list-functions request without providing any tenant identity
- **THEN** the response status is 401 and no function data is returned

### Requirement: Functions endpoint returns 501 when not configured

The system SHALL return HTTP 501 with `code: "FUNCTIONS_DISABLED"` for any functions
request when `FN_BACKEND=off` is set or no backend is configured, so that deployments
that opt out of the Functions capability fail fast rather than silently.

#### Scenario: Functions route returns 501 when executor is disabled

- **WHEN** the control-plane starts with `FN_BACKEND=off` and a caller requests any
  functions endpoint
- **THEN** the response status is 501 with `code: "FUNCTIONS_DISABLED"`

### Requirement: Pluggable embedding-provider backend is registered per workspace

The system SHALL support a pluggable embedding-provider backend following the same
`{ invoke(text, params) }` interface pattern established in
`apps/control-plane/src/runtime/functions-executor.mjs::localWorkerBackend` (lines
34-49). The provider SHALL be registered per workspace (tenant-scoped), configurable
via `PUT /v1/workspaces/{id}/embedding-provider` (`structural_admin` privilege),
and the provider API key SHALL be supplied as a `secretRef` resolving via the existing
Vault + External Secrets (ESO) secret path, never as a plaintext value. A `null`
provider configuration means in-platform embedding is disabled for that workspace.

#### Scenario: Workspace embedding provider is set via structural admin route

- **WHEN** a structural admin submits `PUT /v1/workspaces/{id}/embedding-provider`
  with `{ "providerType": "openai", "model": "text-embedding-3-small",
  "secretRef": { "vaultPath": "secret/ws-abc/openai-key" } }`
- **THEN** the system persists the provider configuration (without the resolved secret
  value), returns HTTP 200, and subsequent KNN searches with `queryText` on that
  workspace use this provider

#### Scenario: Embedding provider is invoked with the workspace-scoped secret

- **WHEN** a KNN search with `queryText` triggers the embedding provider for workspace A
- **THEN** the provider backend resolves the secret from the Vault path stored in
  workspace A's provider config and calls the provider API using that credential;
  workspace B's secret is never accessed

#### Scenario: Removing the provider disables in-platform embedding

- **WHEN** a structural admin submits `DELETE /v1/workspaces/{id}/embedding-provider`
- **THEN** subsequent KNN searches with `queryText` on that workspace return HTTP 422
  with an error indicating no provider is configured, and no provider API call is made

### Requirement: Embedding provider backend is replaceable without data migration

The system SHALL allow the embedding provider to be replaced on a workspace (via a
subsequent `PUT`) without affecting existing stored vectors. Replacing the provider does
NOT trigger re-embedding of stored data; the platform SHALL warn in the response that
existing vectors may have been generated with a different model and dimension.

#### Scenario: Provider replacement is accepted and returns a migration warning

- **WHEN** a structural admin replaces an existing embedding provider on a workspace
  with a provider of different `model` or `dimension`
- **THEN** the system accepts the update (HTTP 200), persists the new configuration,
  and includes a `warning` field in the response body stating that existing vectors
  were generated by the previous provider and may require re-indexing

