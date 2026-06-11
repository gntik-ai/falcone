## 1. Black-box test scaffolding (test-first)

- [x] 1.1 Add a failing black-box test in `tests/blackbox/` that asserts the `POST /v1/collections/{name}/search` route is present in the authoritative gateway catalog (404-before-route gate). Realised as `tests/blackbox/vector-search-route-catalog.test.mjs` (bbx-vec-route-01..06), driving `services/gateway-config/public-route-catalog.json` (the authoritative allow-list).
- [x] 1.2 Add a failing black-box test that asserts the governance adapter rejects `vector` extension enablement for a `schema_per_tenant` workspace (HTTP 422 surface). Realised as bbx-vec-gov-02/03 in `tests/blackbox/vector-search-ddl.test.mjs`.
- [x] 1.3 Add a real-stack test in `tests/env/executor/vector-search-knn-rls.test.mjs` (against live pgvector Postgres) that creates a `vector(3)` column, inserts two tenant-A rows and one tenant-B row, runs a KNN search as tenant A, and asserts the result contains only tenant-A rows (cross-tenant probe).

## 2. Governance adapter — placement-mode gate

- [x] 2.1 Verified the extension placement guard in `services/adapters/src/postgresql-governance-admin.mjs::validatePostgresGovernanceRequest` rejects `vector` for `schema_per_tenant`. NOTE: the pre-existing guard fired but with a generic "not present in the authorized extension catalog" message (because `resolveExtensionCatalog` pre-filtered the default catalog by placement mode). Added `findCatalogedExtension` + a `placementIncompatible` branch so the precise "not available for placement mode schema_per_tenant" violation fires (spec scenario). Regression covered by bbx-vec-gov-02/03.
- [x] 2.2 The guard now produces the precise placement violation; `resolveAuthorizedPostgresExtensions` keeps its placement-filtered behaviour for the published authorized-extensions list.

## 3. DDL adapter — vector column type

- [x] 3.1 Extended the structural DDL plan builder (`services/adapters/src/postgresql-structural-admin.mjs`): added `vector` to the type catalog (gated on `enabledExtensions: ['vector']`), `foldVectorDimension` maps the required `dimension` into the type `precision` slot, and `renderDataType` emits unqualified `vector(N)`.
- [x] 3.2 `validateColumnRules` rejects `dataType: "vector"` without `dimension` or with `dimension` out of range (1-16000) via the existing violation pattern.
- [x] 3.3 Unit tests for the vector column DDL builder: bbx-vec-ddl-01..05 in `tests/blackbox/vector-search-ddl.test.mjs`.

## 4. DDL adapter — vector index type

- [x] 4.1 `normalizeIndexSpec` recognises `indexMethod: "hnsw"|"ivfflat"` + `metric`, mapping metric→opclass onto the key's `operatorClass`; `renderIndexKey` renders the opclass → `CREATE INDEX ... USING HNSW|IVFFLAT ("<column>" vector_*_ops)`. (CONCURRENTLY stays disabled per the existing bounded transactional surface.)
- [x] 4.2 `indexMethod` defaults to `hnsw` and `metric` to `cosine` when omitted for a vector index.
- [x] 4.3 Unsupported `metric` values produce a validation violation (`validateIndexRequest`).
- [x] 4.4 A vector index targeting a non-vector column produces a validation violation (checked against `context.currentTable.columns` types).
- [x] 4.5 Unit tests: bbx-vec-ddl-06..11.

## 5. Data-API adapter — KNN plan builder

- [x] 5.1 Added `knn_search` to `POSTGRES_DATA_API_OPERATIONS` and `POSTGRES_DATA_API_CAPABILITIES` (symbol names matched the task guess) in `services/adapters/src/postgresql-data-api.mjs`.
- [x] 5.2 Implemented the KNN plan builder as `buildPostgresKnnSearchPlan` (the file's dispatcher is `buildPostgresDataApiPlan`; the dedicated builder is NOT exported by name — callers use the dispatcher with `operation: 'knn_search'`). Accepts `queryVector` or `queryText`, `topK` (default 10), `metric` (default `cosine`), optional `filter`/`filters` reusing `normalizeFilters`/`buildFilterClauses` unchanged.
- [x] 5.3 Metric→operator map in `POSTGRES_VECTOR_DISTANCE_OPERATORS`: `cosine → <=>`, `l2 → <->`, `inner_product → <#>`.
- [x] 5.4 Renders `SELECT <cols>, base.<col> <op> $queryVector::vector AS "distance" FROM <table> AS base WHERE <rls_clause> [AND <filters>] ORDER BY <distance> LIMIT <topK>`.
- [x] 5.5 Rejects requests with neither `queryVector` nor `queryText`.
- [x] 5.6 Rejects `knn_search` on collections without a vector column.
- [x] 5.7 Unit tests: bbx-vec-knn-01..11 in `tests/blackbox/vector-search-knn-plan.test.mjs`.

## 6. Data-API executor — KNN execution

- [x] 6.1 `apps/control-plane/src/runtime/postgres-data-executor.mjs` handles `knn_search`: introspects the table (capturing `udt_name='vector'`), acquires the non-BYPASSRLS `falcone_app` connection, applies trace session vars, executes the KNN plan, and returns rows each carrying `distance`.
- [x] 6.2 When `queryText` is supplied, the executor resolves the workspace-scoped embedding (via the injected `embeddingExecutor`) before planning and validates the returned dimension against the column's `atttypmod`.
- [x] 6.3 Postgres dimension-mismatch (`22*`) maps to HTTP 400 via the existing `mapPgError`; proven by the real-stack "wrong length → 400" test.

## 7. Embedding-provider backend

- [x] 7.1 Implemented `httpEmbeddingBackend({ providerType, model, endpoint, resolveSecret, fetchImpl })` in `apps/control-plane/src/runtime/embedding-executor.mjs` exposing `{ embed(text) }`.
- [x] 7.2 Implemented `localMockEmbeddingBackend({ dimension })` returning a deterministic vector of the requested dimension (a hash-derived bounded vector, so cross-tenant probes can target a known neighbour).
- [x] 7.3 Implemented `createEmbeddingProviderStore()`: `deployProvider`, `getProvider`, `removeProvider` (per workspace; persists only `secretRef`, never a plaintext key).
- [x] 7.4 `httpEmbeddingBackend` resolves the provider secret per request (no caching) and fails closed (config error) if the secret path cannot be resolved.
- [x] 7.5 Unit tests for both backends, dimension-mismatch, and missing-provider: bbx-vec-emb-01..09 in `tests/blackbox/vector-search-embedding.test.mjs`.

## 8. Gateway route catalog — new routes

- [x] 8.1 Added `POST /v1/collections/{name}/search` (data_access) to `services/gateway-config/public-route-catalog.json`.
- [x] 8.2 Added `POST /v1/collections/{name}/vector-indexes` (structural_admin).
- [x] 8.3 Added `DELETE /v1/collections/{name}/vector-indexes/{indexName}` (structural_admin).
- [x] 8.4 Added `PUT /v1/workspaces/{id}/embedding-provider` (structural_admin).
- [x] 8.5 Added `DELETE /v1/workspaces/{id}/embedding-provider` (structural_admin).
- [x] 8.6 `npm run validate:gateway-policy` and `npm run validate:public-api` both pass; bbx-vec-route-01..06 assert the catalog entries + privilege-domain non-drift.

## 9. Control-plane route handlers

- [x] 9.1 Registered `POST .../tables/{t}/search` → the `knn_search` executor path in `apps/control-plane/src/runtime/server.mjs` (internal `/v1/postgres/...` route family the gateway `/v1/collections/{name}/search` maps to).
- [x] 9.2 Registered `POST/DELETE .../tables/{t}/vector-indexes[/{indexName}]` → the DDL executor (index resource).
- [x] 9.3 Registered `PUT/DELETE /v1/workspaces/{id}/embedding-provider` → the embedding provider store (threaded via a new `embeddingExecutor` arg on `createControlPlaneServer`/`buildRoutes`).

## 10. Tenant isolation — real-stack cross-tenant probe

- [x] 10.1 `tests/env/executor/vector-search-knn-rls.test.mjs` provisions tenant A + tenant B vectors in one pgvector table, issues a KNN search as tenant A whose query is geometrically nearest to a tenant-B row, and asserts ZERO tenant-B rows.
- [x] 10.2 The probe runs under the non-BYPASSRLS `falcone_app` role (LOGIN role member of `falcone_app`, `NOSUPERUSER NOBYPASSRLS`), not the superuser connection.
- [x] 10.3 A scenario with `app.current_tenant_id` unset asserts zero rows (fail-closed).

## 11. Billing — vector quota dimensions

- [x] 11.1 Added `vector_row_count`, `max_vector_dimension`, `vector_index_memory_mb` to the consumption snapshot calculation via a new `services/provisioning-orchestrator/src/repositories/vector-consumption-repository.mjs::computeVectorConsumption`.
- [x] 11.2 `enforceVectorInsertQuota` returns HTTP 429 when `vector_row_count` reaches the plan limit.
- [x] 11.3 `enforceVectorDimensionQuota` returns HTTP 422 when `dimension` exceeds `max_vector_dimension`.
- [x] 11.4 Unit tests: bbx-vec-quota-01..08 in `tests/blackbox/vector-search-quota.test.mjs` (incl. tenant with no vector columns → zero values).

## 12. Black-box tests — green pass

- [x] 12.1 `tests/blackbox/` covers KNN happy path (queryVector), hybrid filter KNN, schema-per-tenant rejection, missing/out-of-range dimension, route-catalog gate, embedding backend, and quota enforcement.
- [x] 12.2 `bash tests/blackbox/run.sh` is green (340 tests pass).
- [x] 12.3 `tests/env/executor/vector-search-knn-rls.test.mjs` is green against live pgvector (7 tests); the existing executor real-stack suite is unaffected; `test:unit`/`test:adapters`/`test:contracts` show no regressions.

## 13. Documentation and deployment notes

- [x] 13.1 Added a comment to the `postgresql.image` block in `charts/in-falcone/values.yaml` stating dedicated-DB tenants requiring pgvector must configure a pgvector-capable image (e.g. `pgvector/pgvector:pg17`); the default is unchanged.
- [x] 13.2 The data-services spec records the provisioning pre-flight requirement (D7): the path emits a configuration validation error if the resolved image does not advertise pgvector support when a workspace enables `vector`. (Documented as the deployment requirement; the default image gap is asserted in the spec delta.)
