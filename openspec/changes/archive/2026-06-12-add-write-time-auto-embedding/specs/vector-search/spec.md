## ADDED Requirements

### Requirement: In-platform embedding generation covers both query time and write time

The system SHALL invoke `embeddingExecutor.embedForWorkspace` not only on the KNN `queryText`
read path (the existing `POST .../search` hook in
`apps/control-plane/src/runtime/postgres-data-executor.mjs` lines 175-181), but also at write
time for `insert`, `bulk_insert`, and `update` operations when a per-collection embedding mapping
is configured, so that applications can store plain text and receive a populated `vector(N)` column
without computing embeddings client-side.

The write-time hook mirrors the read-time pattern exactly: it calls
`columnVectorDimension(client, schemaName, tableName, targetColumn)` to obtain the declared
dimension N, then calls
`embeddingExecutor.embedForWorkspace(workspaceId, text, { expectedDimension: N, tenantId })`.
An explicitly provided target vector in the payload is respected and the hook does NOT override it.

#### Scenario: Write-time embedding populates the vector column on insert

- **WHEN** a structural admin has configured an embedding mapping (source column `body`, target
  column `embedding`) on a collection that has a `vector(1536)` column, and a data-access caller
  inserts a row with `{ "body": "hello world" }` and no `embedding` field
- **THEN** the system generates the embedding in-platform via `embedForWorkspace`, sets the
  `embedding` column to the resulting vector, stores the row, and the subsequent KNN search on
  `embedding` returns the inserted row

#### Scenario: Explicit target vector is preserved without re-embedding

- **WHEN** a mapping is configured and a caller inserts a row with both the source text column
  and an explicit `embedding` vector value
- **THEN** the system stores the explicitly provided vector as-is and does NOT call
  `embedForWorkspace` for that row

#### Scenario: Write-time embedding dimension mismatch is rejected

- **WHEN** a mapping is configured and the embedding provider returns a vector whose length
  differs from the declared dimension of the target `vector(N)` column
- **THEN** the write is rejected with HTTP 422 and `code: "EMBEDDING_DIMENSION_MISMATCH"`,
  and no row is written to the database

#### Scenario: Write blocked with clear error when no provider is configured

- **WHEN** an embedding mapping is configured for a collection but no embedding provider has
  been registered for the workspace, and a caller inserts a row with the source text column
- **THEN** the write is rejected with HTTP 422 and `code: "EMBEDDING_PROVIDER_MISSING"`,
  and no row is written

### Requirement: Per-collection embedding mapping is operator-configured, tenant-scoped, and durable

The system SHALL persist a per-collection embedding mapping keyed by
`(tenant_id, workspace_id, schema_name, table_name, target_column)` in a
`workspace_embedding_mappings` table on the metadata database, mirroring the
`workspace_embedding_providers` pattern from `add-embedding-provider-persistence`
(`apps/control-plane/src/runtime/embedding-executor.mjs::createEmbeddingProviderStore`).
An in-memory fallback (no-pool construction) SHALL be preserved as the test seam.

The operator configures the mapping via `PUT` on the table-scoped mapping route; deletion is
via `DELETE` on the same resource; retrieval is via `GET`. All routes carry
`privilege_domain: "structural_admin"` consistent with the embedding-provider routes in
`services/gateway-config/public-route-catalog.json` (lines 147-154).

#### Scenario: Mapping write is scoped to tenant and workspace

- **WHEN** tenant A configures a mapping on workspace W, schema S, table T and tenant B
  configures a different mapping on a workspace with the same `workspaceId` value W
- **THEN** each tenant's mapping record is stored independently keyed by
  `(tenant_id, workspace_id, schema_name, table_name, target_column)`; write-time embedding
  for tenant A uses tenant A's mapping and provider; no cross-tenant leakage occurs

#### Scenario: Mapping survives restart and is visible to all replicas

- **WHEN** an operator configures an embedding mapping via the API on one control-plane replica
  and the process is restarted (or a second replica is queried)
- **THEN** the mapping record is present because it is persisted in `workspace_embedding_mappings`
  on the shared metadata pool, not held in-memory

### Requirement: Cross-tenant write-time probe never applies another tenant's mapping

The system SHALL ensure that the write-path auto-embed hook resolves the mapping by
`(tenant_id, workspace_id, schema_name, table_name, target_column)` using the verified
identity's `tenantId`, so that a write by tenant A never triggers an embedding derived from
tenant B's mapping or provider configuration.

#### Scenario: Cross-tenant write probe does not apply another tenant's mapping

- **WHEN** tenant A has an embedding mapping on workspace W / table T and tenant B submits
  an insert into a workspace and table with the same identifiers but under tenant B's identity
- **THEN** tenant B's insert does NOT auto-embed via tenant A's mapping; if tenant B has no
  mapping configured the insert proceeds without auto-embedding

