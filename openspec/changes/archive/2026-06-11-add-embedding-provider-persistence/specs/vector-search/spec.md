## MODIFIED Requirements

### Requirement: In-platform embedding generation translates query text to a vector

The running control-plane SHALL construct an `embeddingExecutor` (via `createEmbeddingExecutor`
from `apps/control-plane/src/runtime/embedding-executor.mjs`) backed by a Postgres-persistent
`createEmbeddingProviderStore({ pool })` and SHALL pass it as `embeddingExecutor` to
`createControlPlaneServer`, so that the `queryText` KNN path (the `POST .../search` route in
`apps/control-plane/src/runtime/server.mjs`) and the
`PUT/DELETE /v1/workspaces/{id}/embedding-provider` routes are operational
rather than returning HTTP 501 `EMBEDDING_DISABLED`.

#### Scenario: queryText KNN search succeeds when a provider is configured

- **WHEN** a structural admin has configured an embedding provider via
  `PUT /v1/workspaces/{id}/embedding-provider` and a data-access caller submits a
  `POST /v1/.../search` with `queryText`
- **THEN** the system SHALL return KNN results (HTTP 200) rather than HTTP 501
  `EMBEDDING_DISABLED`, because the `embeddingExecutor` is wired in the running control-plane

#### Scenario: Embedding provider routes return 422 not 501 when no provider is configured

- **WHEN** the control-plane starts with a Postgres-backed `embeddingExecutor` wired and a
  `queryText` KNN request targets a workspace with no configured provider
- **THEN** the system MUST return HTTP 422 with `code: "EMBEDDING_PROVIDER_MISSING"` (the
  `createEmbeddingExecutor::resolveBackend` error in `embedding-executor.mjs`) rather
  than HTTP 501, confirming the executor is active

### Requirement: Embedding provider is tenant-scoped and credentials are stored via secret refs

The system SHALL scope reads and writes of a workspace's embedding-provider record to the
`(tenant_id, workspace_id)` pair so that a write for workspace W under tenant A cannot
overwrite or shadow the provider record of workspace W under tenant B, consistent with the
`workspace_api_keys` scoping pattern in
`apps/control-plane/src/runtime/api-keys.mjs` (lines 36-48).

#### Scenario: Embedding provider write is scoped to tenant and workspace

- **WHEN** tenant A configures an embedding provider on workspace W and tenant B subsequently
  configures a different provider on a workspace with the same `workspaceId` value W
- **THEN** each tenant's provider record SHALL be stored independently keyed by
  `(tenant_id, workspace_id)`; a `queryText` KNN search by tenant A MUST use tenant A's
  provider and tenant B MUST use tenant B's provider, with no cross-tenant leakage
