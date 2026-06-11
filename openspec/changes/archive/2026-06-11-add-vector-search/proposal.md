## Why

Falcone's data plane is built on Postgres, which already ships the `vector` extension in the governance catalog (`services/adapters/src/postgresql-governance-admin.mjs::POSTGRES_EXTENSION_CATALOG`, lines 36-41) restricted to `database_per_tenant` placement — but there is no search operation, no KNN query planner, no vector column type, and no embedding-generation path. Tenants with dedicated databases need similarity search (semantic search, recommendation, nearest-neighbour classification) without adding a second vector-database dependency.

## What Changes

- **New capability `vector-search`**: similarity (KNN) query surface with L2/cosine/inner-product metrics, top-k, hybrid scalar filter (reusing existing `POSTGRES_DATA_FILTER_OPERATORS`), and in-platform embedding generation via a pluggable, tenant-scoped provider.
- **`schema-management` delta**: add `vector` as a declared field type with a mandatory `dimension` attribute; add vector index declaration (HNSW default, configurable metric/opclass).
- **`data-services` delta**: enablement of the `vector` pgvector extension gates on `database_per_tenant` placement, building on the existing `POSTGRES_EXTENSION_CATALOG` entry; reject enablement for shared/schema-per-tenant tenants.
- **`data-api` delta**: add a `knn_search` operation alongside existing CRUD, routed through a new `POST /v1/collections/{name}/search` endpoint (`data_access` privilege domain, matching the `/v1/collections/{name}/...` convention in `services/gateway-config/public-route-catalog.json`).
- **`tenant-isolation` delta**: the cross-tenant KNN guarantee — a tenant's KNN query MUST NEVER return another tenant's vectors even when numerically closer, enforced by the non-BYPASSRLS `falcone_app` role and RLS policies already described in the existing tenant-isolation spec.
- **`functions` delta**: pluggable embedding-provider backend for in-platform embedding generation, following the same `{ invoke(source, params) }` backend pattern as `apps/control-plane/src/runtime/functions-executor.mjs::localWorkerBackend`.
- **`billing` delta**: new vector quota dimensions (vector row count, max dimension, index memory) for noisy-neighbor control.

## Capabilities

### New Capabilities
- `vector-search`: KNN similarity search, metric selection (cosine/L2/inner-product), top-k, hybrid filter, index type management (HNSW/IVFFlat), and in-platform embedding-provider abstraction.

### Modified Capabilities
- `schema-management`: add `vector(N)` field type with required `dimension`; add vector index (HNSW/IVFFlat) declaration via DDL surface.
- `data-services`: gate pgvector extension enablement on `database_per_tenant`; reject for shared tenants.
- `data-api`: add `knn_search` operation and `POST /v1/collections/{name}/search` route.
- `tenant-isolation`: cross-tenant KNN isolation guarantee via RLS + non-BYPASSRLS role.
- `functions`: pluggable embedding-provider backend (same backend abstraction pattern), tenant-scoped by workspace, provider secrets via `config.secretRefs` / Vault + ESO.
- `billing`: vector quota dimensions (vector_row_count, max_vector_dimension, vector_index_memory_mb).

## Impact

- **Code grounding (no source changes in this proposal)**:
  - `services/adapters/src/postgresql-governance-admin.mjs` — `POSTGRES_EXTENSION_CATALOG` already has `vector` with `placementModes: ['database_per_tenant']`; proposal extends from it.
  - `tests/adapters/postgresql-admin.test.mjs` (lines 427-635) — already exercises `dataType: 'public.vector'`, `enabledExtensions: ['vector']`; serves as baseline for new tests.
  - `services/adapters/src/postgresql-data-api.mjs` — `POSTGRES_DATA_FILTER_OPERATORS` (lines 26-40) and `normalizeOrder` (lines 272-299) have no distance operator or KNN order mode; those are the gaps this change fills.
  - `apps/control-plane/src/runtime/postgres-data-executor.mjs` and `postgres-ddl-executor.mjs` — KNN plan execution and vector column/index DDL go through these executors.
  - `apps/control-plane/src/runtime/functions-executor.mjs` — pluggable backend pattern (`localWorkerBackend`); embedding provider follows the same pattern.
  - `services/gateway-config/public-route-catalog.json` — new route `POST /v1/collections/{name}/search` follows existing `data_access` collection convention; structural admin routes for vector index config follow existing `structural_admin` patterns.
  - `charts/in-falcone/values.yaml` line 1698-1699 — default image is `bitnami/postgresql:17.2.0` which does NOT include pgvector; dedicated-DB tenants need a pgvector-capable image (e.g. `pgvector/pgvector:pg17` or `bitnami/postgresql` with pgvector build); this is consistent with the `database_per_tenant` restriction.
- **New routes**: `POST /v1/collections/{name}/search` (data_access), `POST /v1/collections/{name}/vector-indexes` (structural_admin), `DELETE /v1/collections/{name}/vector-indexes/{indexName}` (structural_admin), `PUT /v1/workspaces/{id}/embedding-provider` (structural_admin).
- **Dependencies**: pgvector Postgres extension (already catalogued); optional HTTP embedding provider (e.g. OpenAI embeddings API); Vault + ESO for provider API key secret refs.
- **Breaking changes**: none — the feature is additive; existing tenants without `vector` extension enabled are unaffected.
