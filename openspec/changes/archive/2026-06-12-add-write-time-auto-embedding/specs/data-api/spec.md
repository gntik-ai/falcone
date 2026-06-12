## ADDED Requirements

### Requirement: Row write operations apply write-time auto-embedding when a mapping is configured

The system SHALL augment the `insert`, `bulk_insert`, and `update` paths of `executePostgresData`
(`apps/control-plane/src/runtime/postgres-data-executor.mjs`) with a pre-plan auto-embed hook
that fires before `buildRequest` is called. The hook behaviour:

1. Look up an embedding mapping for `(tenantId, workspaceId, schemaName, tableName)` from the
   injected `mappingStore`. If no mapping is found, proceed without modification.
2. If a mapping is found and the source column is present and non-empty in `params.values`
   (for `insert`) or in the row (for `bulk_insert`) or in `params.changes` (for `update`),
   AND the target column is NOT already present in the payload, call
   `embeddingExecutor.embedForWorkspace(workspaceId, sourceText, { expectedDimension, tenantId })`
   where `expectedDimension` is resolved via `columnVectorDimension(client, schemaName,
   tableName, targetColumn)`.
3. Set the target column in the payload to the resulting vector (formatted as a `[a,b,c]` literal
   string, matching the pgvector binding used at lines 1870-1872 of
   `services/adapters/src/postgresql-data-api.mjs`).
4. If the caller explicitly provides the target vector column, store it as-is (no override).

The hook is only active when both `mappingStore` and `embeddingExecutor` are present in the params.
Existing callers that do not pass these fields receive identical behaviour to the current
implementation.

#### Scenario: Auto-embed insert stores the vector and a subsequent KNN search returns the row

- **WHEN** a mapping is configured for (workspace W, schema S, table T, sourceColumn `body`,
  targetColumn `embedding`) and a data-access caller inserts `{ "body": "semantic test" }`
  with no `embedding` field
- **THEN** the executor generates the embedding, stores the row with `embedding` populated,
  and a subsequent `knn_search` on the same table returns the inserted row with a non-null
  `distance` field

#### Scenario: Bulk insert auto-embeds each row independently

- **WHEN** a mapping is configured and a caller submits a bulk insert of N rows each with the
  source text column set and no target vector column
- **THEN** each row receives its own independently generated embedding and all N rows are written
  atomically; if any embedding call fails the entire batch is rejected and no rows are written

#### Scenario: Update re-embeds only when the source column is in the change set

- **WHEN** a mapping is configured and a caller submits an update whose `changes` include the
  source text column but no target vector column
- **THEN** the executor generates a new embedding for the updated text and includes it in the
  `changes` sent to the plan builder, so the stored vector reflects the new text after the update

#### Scenario: Update that omits the source column does not re-embed

- **WHEN** a mapping is configured and a caller submits an update whose `changes` do NOT include
  the source text column
- **THEN** the executor does NOT call `embedForWorkspace` and the target vector column is left
  unchanged in the database

#### Scenario: Tenant identity is stamped before and independent of the auto-embed hook

- **WHEN** an insert with auto-embedding fires for a table that has a `tenant_id` column
- **THEN** the `tenant_id` (and `workspace_id` if present) are stamped by the `stamp()` function
  as they are today, and the auto-embed hook does not interfere with tenant stamping; both the
  `tenant_id` stamp and the `embedding` vector are present in the inserted row

