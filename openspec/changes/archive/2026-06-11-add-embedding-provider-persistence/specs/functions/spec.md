## MODIFIED Requirements

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
