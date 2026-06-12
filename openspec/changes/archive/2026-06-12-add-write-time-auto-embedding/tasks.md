## T01: Confirm baseline green

- [x] Run `bash tests/blackbox/run.sh` and `bash tests/env/executor/run.sh` and record that both
  pass before any changes are made.

**Evidence**: The `tests/blackbox/embedding-provider-persistence.test.mjs` (bbx-emb-persist-01..06)
and `tests/env/executor/vector-search-knn-rls.test.mjs` are the closest existing coverage;
`tests/env/executor/embedding-provider-persistence.test.mjs` (emb-persist-01..07) proves the
provider store is functional. Baseline: blackbox ~346 pass; executor real-stack ~51 pass.

## T02: Add failing real-stack tests (test-first)

- [x] Create `tests/env/executor/auto-embedding-write.test.mjs` (pgvector image required).
- [x] Wire the new file into `tests/env/executor/run.sh`.
- [x] Confirm ALL scenarios in this file FAIL before T03-T07 are implemented.

Scenarios (`auto-emb-01` through `auto-emb-08`):
- `auto-emb-01`: INSERT with source text column → `embedding` vector column populated (non-null).
- `auto-emb-02`: KNN search after auto-embed insert → inserted row is returned.
- `auto-emb-03`: INSERT with explicit `embedding` field → stored value matches provided vector (no override).
- `auto-emb-04`: BULK INSERT 3 rows → all 3 rows have distinct non-null `embedding` values.
- `auto-emb-05`: UPDATE including source column → `embedding` updated; UPDATE omitting source → `embedding` unchanged.
- `auto-emb-06`: Provider missing → INSERT with source text → 422 `EMBEDDING_PROVIDER_MISSING`, 0 rows written.
- `auto-emb-07`: Dimension mismatch (provider returns wrong size) → 422 `EMBEDDING_DIMENSION_MISMATCH`, 0 rows.
- `auto-emb-08`: Cross-tenant probe — tenant A has mapping; tenant B (same workspaceId/table) inserts → no auto-embed fires for tenant B; row has NULL `embedding`.

## T03: Add failing blackbox tests (test-first)

- [x] Create `tests/blackbox/auto-embedding-write.test.mjs`.
- [x] Confirm ALL scenarios FAIL before T04-T07 are implemented.

Scenarios (`bbx-auto-emb-01` through `bbx-auto-emb-08`):
- `bbx-auto-emb-01`: PUT mapping route returns 200 and the stored record.
- `bbx-auto-emb-02`: GET mapping route returns the configured mapping.
- `bbx-auto-emb-03`: DELETE mapping route returns 200 and subsequent GET returns 404.
- `bbx-auto-emb-04`: PUT with no `mappingStore` wired returns 501 (guard, mirroring `EMBEDDING_DISABLED`).
- `bbx-auto-emb-05`: Insert with mock executor + mapping → `embedForWorkspace` called once, insert succeeds.
- `bbx-auto-emb-06`: Insert with explicit target vector → `embedForWorkspace` NOT called.
- `bbx-auto-emb-07`: Insert with source text + dimension mismatch mock → 422 before SQL.
- `bbx-auto-emb-08`: Insert with source text + no provider configured → 422 `EMBEDDING_PROVIDER_MISSING`.

## T04: Add `createEmbeddingMappingStore` to `embedding-executor.mjs`

File: `apps/control-plane/src/runtime/embedding-executor.mjs`

- [x] Add exported `createEmbeddingMappingStore({ pool? } = {})`.
  - No pool → in-memory `Map` (key: `${workspaceId}:${schemaName}:${tableName}:${targetColumn}`).
  - Pool provided → Postgres implementation:
    - `async ensureSchema()` creating `workspace_embedding_mappings`
      (`tenant_id`, `workspace_id`, `schema_name`, `table_name`, `target_column`, `source_column`,
      `updated_at`, `UNIQUE(tenant_id, workspace_id, schema_name, table_name, target_column)`) +
      `idx_wem_lookup` on `(tenant_id, workspace_id, schema_name, table_name)`.
    - `deployMapping(workspaceId, config)` — upsert, accepts `{ tenantId, schemaName, tableName,
      targetColumn, sourceColumn }`, returns the stored record; if a mapping already existed
      returns a `warning` field (`REMAPPING_WARNING`).
    - `getMapping(workspaceId, { tenantId, schemaName, tableName, targetColumn })` — returns
      the matching record or `null`.
    - `removeMapping(workspaceId, { tenantId, schemaName, tableName, targetColumn })` — delete,
      returns `{ removed: boolean }`.
- [x] Export `REMAPPING_WARNING` constant (mirrors `REINDEX_WARNING`).
- [x] Unit test: `createEmbeddingMappingStore()` no-pool — deploy/get/remove/warning cycle.

## T05: Add write-path auto-embed hook to `postgres-data-executor.mjs`

File: `apps/control-plane/src/runtime/postgres-data-executor.mjs`

- [x] After `introspectTable` and before `buildRequest`, insert the auto-embed hook.
- [x] Hook fires only when `params.mappingStore && params.embeddingExecutor` are set AND
  `params.operation` is one of `insert`, `bulk_insert`, `update`.
- [x] For `insert`:
  - Call `params.mappingStore.getMapping(workspaceId, { tenantId, schemaName, tableName, targetColumn: mapping.targetColumn })`.
  - If mapping found, source column present in `params.values` AND target column absent:
    - Call `columnVectorDimension(client, schemaName, tableName, mapping.targetColumn)`.
    - Call `params.embeddingExecutor.embedForWorkspace(workspaceId, sourceText, { expectedDimension, tenantId })`.
    - Set `params.values[mapping.targetColumn]` to the resulting `[a,b,c]` literal string.
- [x] For `bulk_insert`: iterate over each row in `params.rows`, apply the same logic per row.
  If any `embedForWorkspace` call rejects, propagate the error before any SQL is issued.
- [x] For `update`: same logic on `params.changes` (source key present AND target key absent).
- [x] Explicit target column value in payload → skip hook for that row/field entirely.
- [x] Integration risk (D3) RESOLVED — the LITERAL path: the real-stack round-trip
  (`auto-emb-01`/`auto-emb-02`) proves a string literal `"[a,b,c]"` bound as `$N` with NO cast
  coerces correctly into a `vector(N)` column on INSERT/UPDATE/bulk INSERT (Postgres applies the
  assignment cast text→vector because the target column type is known; wrong dimension fails with
  pgvector's native error → 422). NO change to `services/adapters/src/postgresql-data-api.mjs`
  was required; the hook sets `row[target]` to the `[a,b,c]` literal and relies on the existing
  generic binder (mirrors the KNN read literal at postgresql-data-api.mjs ~lines 1870-1872).
- [x] Existing callers that pass neither `mappingStore` nor `embeddingExecutor` are unaffected.

## T06: Add mapping routes to `server.mjs` and `public-route-catalog.json`

File: `apps/control-plane/src/runtime/server.mjs`

- [x] Add `mappingStore` parameter to `buildRoutes` (alongside `embeddingExecutor`).
- [x] Add three executor route entries inside `buildRoutes` (under the existing Postgres data
  prefix `^/v1/postgres/workspaces/([^/]+)/data/([^/]+)/schemas/([^/]+)/tables/([^/]+)`):
  - `PUT  .../embedding-mapping$` → `mappingStore.deployMapping(...)`, return 200 with the stored record.
  - `GET  .../embedding-mapping$` → `mappingStore.getMapping(...)`, return 200 or 404.
  - `DELETE .../embedding-mapping$` → `mappingStore.removeMapping(...)`, return 200.
    The verified identity's `tenantId` is injected (never the body); `targetColumn` defaults to the
    table's single mapped column when not supplied as a query param.
- [x] Thread `mappingStore` and `embeddingExecutor` into all `executePostgresData` calls for write
  operations (insert, bulk_insert, update rows endpoints).
- [x] Add `requireMappingStore` guard (mirrors `requireStore`): when `mappingStore` is not wired,
  return 501 `MAPPING_STORE_DISABLED`.

File: `services/gateway-config/public-route-catalog.json`

- [x] Add the PUBLIC-facing mapping config entries, matching the `embedding-provider` precedent
  (which exposes only `PUT`+`DELETE` in this catalog — `structural_admin`). The catalog uses the
  public collection alias (`/v1/collections/{name}/...`), not the executor-internal data prefix:
  ```json
  { "method": "POST",   "path": "/v1/collections/{name}/embedding-mapping", "privilege_domain": "structural_admin" },
  { "method": "DELETE", "path": "/v1/collections/{name}/embedding-mapping", "privilege_domain": "structural_admin" }
  ```

## T07: Wire `mappingStore` into `main.mjs`

File: `apps/control-plane/src/runtime/main.mjs`

- [x] Import `createEmbeddingMappingStore` from `./embedding-executor.mjs`.
- [x] After constructing `embeddingStore`, add:
  `const mappingStore = createEmbeddingMappingStore({ pool: keyPool });`
- [x] Add `mappingStore.ensureSchema()` to the startup
  `Promise.all([apiKeyStore.ensureSchema(), embeddingStore.ensureSchema(), mappingStore.ensureSchema()])`.
- [x] Pass `mappingStore` to `createControlPlaneServer(...)`.
- [x] `keyPool.end()` in `shutdown()` already covers this store — no additional teardown needed.

## T08: Run full test suites and confirm green

- [x] `bash tests/blackbox/run.sh` — all existing tests pass; new `bbx-auto-emb-01..08` pass.
- [x] `bash tests/env/executor/run.sh` — `auto-embedding-write.test.mjs` (`auto-emb-01..08`) pass
  against the pgvector image; `vector-search-knn-rls.test.mjs` and
  `embedding-provider-persistence.test.mjs` still pass; no regressions.
- [x] `corepack pnpm test:unit` — `createEmbeddingMappingStore` in-memory tests pass; no regressions.
- [x] `corepack pnpm test:adapters` — insert binder change (if any) covered; pass.
- [x] `corepack pnpm test:contracts` — no regressions.
- [x] `corepack pnpm lint` — clean.
- [x] `openspec validate add-write-time-auto-embedding --strict` — clean.
