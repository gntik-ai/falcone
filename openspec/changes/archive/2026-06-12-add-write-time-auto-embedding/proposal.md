## Why

Today the platform generates embeddings only at query time: when a KNN search request carries
`queryText`, `postgres-data-executor.mjs` (lines 175-181) calls
`embeddingExecutor.embedForWorkspace` before building the SQL plan. This means every application
that wants semantic search must either (a) compute embeddings client-side and supply a raw
`queryVector` on every insert, or (b) omit the vector column entirely and rely on `queryText` at
search time.

Option (a) tightly couples application code to an AI provider and requires the client to know the
exact model and dimension in use. Option (b) prevents pre-indexing: the HNSW/IVFFlat index built
over the `vector(N)` column is only useful when that column is populated at insert time, so
leaving it empty defeats the ANN index and forces a full-table scan on every search.

The platform already ships all the building blocks — `createEmbeddingExecutor`,
`columnVectorDimension`, `table.vectorColumns` introspection, and the per-workspace persistent
provider store from `add-embedding-provider-persistence` — but they are wired only on the read
path. This change closes the gap: operators configure a per-collection mapping
(source text column → target vector column) once, and thereafter every insert or update that
touches the source column automatically has its embedding generated in-platform and stored in the
target `vector(N)` column.

## What Changes

- **New: embedding mapping store** (`workspace_embedding_mappings` table on the metadata DB,
  mirroring `workspace_embedding_providers`). A mapping record binds a `(workspaceId, schemaName,
  tableName, targetColumn)` tuple to a `sourceColumn` name. An in-memory fallback (no-pool
  construction) preserves testability.
- **New: write-path hook in `executePostgresData`** (`postgres-data-executor.mjs`). Before the
  plan is built, for `insert`, `bulk_insert`, and `update` operations the executor looks up a
  configured mapping for the table. When a mapping is found and the source column is present in
  the payload (and the target column is NOT already provided), it calls
  `embeddingExecutor.embedForWorkspace` — mirroring the existing KNN `queryText` block (lines
  175-181) — and sets the target column to the resulting `[...]` vector literal. The stamped
  `values`/`rows`/`changes` then flow into `buildRequest` unchanged.
- **New: routes** for mapping CRUD under the existing Postgres data prefix. Four new executor
  routes handle `PUT`, `DELETE`, `GET`, and `GET` (list) on the mapping resource. Four
  corresponding entries are added to `services/gateway-config/public-route-catalog.json` with
  `privilege_domain: "structural_admin"` (mapping config is operator-level, consistent with
  `embedding-provider` routes).
- **`main.mjs` wiring**: the mapping store is constructed on the shared `keyPool` and passed to
  `createControlPlaneServer`; `ensureSchema()` is added to the startup `Promise.all`.
- **Vector-insert binding**: the auto-embedded vector is supplied as the same `[a,b,c]` literal
  string that the KNN read path uses (`postgresql-data-api.mjs` lines 1870-1872). The insert
  binder must cast it to `::vector`; a real-stack test proves the round-trip.

## Capabilities

### New Capabilities

_(none — this change extends existing capabilities)_

### Modified Capabilities

- `vector-search`: the in-platform embedding executor now also covers write-time embedding via
  mapping configuration; the `queryText` KNN read path is unchanged but the embedding service
  is now also invoked on insert/update.
- `data-api`: the write path (`insert`, `bulk_insert`, `update`) gains an auto-embed hook that
  transparently populates `vector(N)` columns when a mapping is configured.

## Impact

- **`apps/control-plane/src/runtime/embedding-executor.mjs`** — new
  `createEmbeddingMappingStore({ pool? })` exported alongside the existing provider store; same
  `ensureSchema` + upsert/get/delete pattern.
- **`apps/control-plane/src/runtime/postgres-data-executor.mjs`** — `executePostgresData` gains
  a pre-plan auto-embed hook (mirroring lines 175-181) that fires for `insert`, `bulk_insert`,
  and `update` when the `mappingStore` param is set and a matching mapping record is found.
- **`apps/control-plane/src/runtime/server.mjs`** — four new route entries for embedding mapping
  CRUD; `mappingStore` threaded into `executePostgresData` calls.
- **`apps/control-plane/src/runtime/main.mjs`** — `mappingStore` constructed on `keyPool`, wired
  into `createControlPlaneServer`, `ensureSchema` added to startup `Promise.all`.
- **`services/gateway-config/public-route-catalog.json`** — four new `structural_admin` routes
  for the mapping resource.
- **Postgres schema** — one new table `workspace_embedding_mappings`.
- **Tests** — real-stack tests in `tests/env/executor/` prove insert + KNN round-trip, update
  re-embedding, explicit-vector preservation, provider-missing fail-close, and cross-tenant
  isolation. Blackbox tests cover the mapping CRUD routes and the auto-embed executor path.
- **Breaking changes**: none — `executePostgresData` accepts `mappingStore` as an optional param;
  existing callers that omit it get the existing behaviour.
