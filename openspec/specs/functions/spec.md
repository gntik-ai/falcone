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

The system SHALL persist the embedding-provider configuration durably in a Postgres-backed store
(`workspace_embedding_providers` table on the `CONTROL_DB_URL ?? DATA_DB_URL` metadata pool,
mirroring the `createApiKeyStore` pattern in
`apps/control-plane/src/runtime/api-keys.mjs::createApiKeyStore`) so that provider configuration
survives a control-plane process restart and is visible to all replicas sharing the same metadata
database. The system SHALL store ONLY the `secretRef` JSON object — never the resolved plaintext
API key — in the `secret_ref` column (the `deployProvider` upsert strips any caller-supplied
`apiKey`/`secret` via `const { apiKey, secret, tenantId, ...safe } = config`), consistent with the
fail-closed secret-resolution contract enforced in
`apps/control-plane/src/runtime/embedding-executor.mjs::httpEmbeddingBackend` (the
`EMBEDDING_SECRET_UNRESOLVED` 500 when a secret cannot be resolved).

#### Scenario: Provider configuration survives a control-plane restart

- **WHEN** a structural admin configures an embedding provider on a workspace via
  `PUT /v1/workspaces/{id}/embedding-provider` and the control-plane process is subsequently
  restarted (new process, fresh in-memory state)
- **THEN** a subsequent `queryText` KNN search against that workspace resolves the same provider
  configuration from the Postgres-backed store without requiring reconfiguration

#### Scenario: Provider is visible to a second replica sharing the metadata DB

- **WHEN** an embedding provider is configured on workspace W through control-plane replica R1
  (which writes to the shared `CONTROL_DB_URL` Postgres pool)
- **THEN** control-plane replica R2 sharing the same `CONTROL_DB_URL` MUST read the identical
  provider configuration for workspace W, so `queryText` KNN searches routed to R2 succeed using
  the same provider

#### Scenario: Plaintext API key is never persisted

- **WHEN** a structural admin submits `PUT /v1/workspaces/{id}/embedding-provider` with a body
  that includes both a `secretRef` and any plaintext `apiKey` or `secret` field
- **THEN** the system SHALL persist only the `secretRef` value; the plaintext field is stripped
  before writing and is absent from any subsequent read of the stored configuration

### Requirement: Embedding provider backend is replaceable without data migration

The system SHALL preserve the re-index warning behaviour when a provider is replaced via the
Postgres-backed store, identical to the in-memory behaviour in
`apps/control-plane/src/runtime/embedding-executor.mjs::createEmbeddingProviderStore` (both
the in-memory and Postgres paths share the `REINDEX_WARNING` constant): replacing an existing
provider record MUST include a `warning` field in the response stating that existing vectors may
require re-indexing.

#### Scenario: Provider replacement via Postgres-backed store preserves the re-index warning

- **WHEN** a structural admin replaces an already-persisted embedding provider on a workspace
  (second `PUT` to the same workspace) using the Postgres-backed store
- **THEN** the response SHALL include the `warning` field stating existing vectors may require
  re-indexing, identical to the behaviour of the in-memory store

### Requirement: Function access MUST be scoped to the caller's tenant

The system SHALL constrain every function lookup by the caller's `tenant_id` and SHALL verify function ownership on the invoke, get, and activations routes, so that a principal cannot invoke or read another tenant's function, inline source, or activation logs.

#### Scenario: Cross-tenant function access by resourceId is rejected

- **WHEN** an authenticated principal of Tenant B invokes, gets, or reads activations for a function `resourceId` owned by Tenant A
- **THEN** the system returns HTTP 404 or 403 and discloses no function source, output, or activation logs

#### Scenario: Own-tenant function access succeeds

- **WHEN** an authenticated principal invokes or reads a function that belongs to its own tenant
- **THEN** the system processes the request and returns the appropriate success status

### Requirement: Serverless functions run on Knative; the OpenWhisk product is removed

The system SHALL run serverless functions on Knative (the control-plane function executor creates a
Knative Service per function), and SHALL remove the OpenWhisk **product**: the vendored OpenWhisk
deployment (`deploy/kind/openwhisk/`), the OpenWhisk ESO secret templates, the disabled `openwhisk:`
chart stanza, and the `backup-status` OpenWhisk-Action CRD template. The functions API **model**
(the `action`/`package`/`trigger`/`rule` vocabulary in the admin adapter, OpenAPI, route catalog,
and domain model) SHALL be retained as Falcone's own functions model and is not rebranded.

#### Scenario: No OpenWhisk product artifact remains

- **WHEN** the repository is searched case-insensitively for OpenWhisk product artifacts (vendored
  deployment, ESO secrets, chart subchart/stanza, Action CRDs)
- **THEN** none is found, and serverless functions still deploy and invoke via Knative

### Requirement: Functions cross-tenant Knative ksvc clobber / code-execution hijack

The system SHALL ensure that functions cross-tenant Knative ksvc clobber / code-execution hijack is corrected: Include tenant id + workspace id (or a hash) in the ksvc name and/or a per-tenant namespace; resolve invoke to the caller-scoped ksvc.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Two same-named workspaces across tenants get distinct ksvcs

