## Context

Falcone's data plane is Postgres-first. The `vector` pgvector extension is already catalogued in
`services/adapters/src/postgresql-governance-admin.mjs::POSTGRES_EXTENSION_CATALOG` (lines 36-41)
with `placementModes: ['database_per_tenant']` and a matching description. Existing adapter tests
(`tests/adapters/postgresql-admin.test.mjs`, lines 427-635) already exercise `dataType: 'public.vector'`
and `enabledExtensions: ['vector']`. The gaps are: no KNN query planner, no vector column/index DDL
path, no in-platform embedding generation, and no search route on the public API surface.

The existing executor pattern (`apps/control-plane/src/runtime/postgres-data-executor.mjs`,
`postgres-ddl-executor.mjs`) and the pluggable backend pattern
(`apps/control-plane/src/runtime/functions-executor.mjs`) provide the integration seams.

## Goals / Non-Goals

**Goals:**
- Provide KNN similarity search on `vector(N)` columns via `POST /v1/collections/{name}/search`.
- Enable pgvector extension via the existing governance surface, restricted to `database_per_tenant` tenants.
- Add `vector(N)` column type and HNSW/IVFFlat index DDL through the existing DDL executor.
- Provide in-platform embedding generation via a pluggable, workspace-scoped provider.
- Enforce full tenant isolation on KNN queries via existing RLS + non-BYPASSRLS role architecture.
- Track vector quota dimensions in the billing metering subsystem.

**Non-Goals:**
- Dedicated vector database (Milvus, Qdrant, Weaviate): Postgres + pgvector is sufficient for v1
  workloads and eliminates an additional dependency.
- BYO-vector-only mode: the platform provides in-platform embedding; clients may still supply raw
  vectors if they prefer.
- Automatic re-embedding on provider change: out of scope for v1; a warning is surfaced instead.
- Shared/schema-per-tenant vector search: deferred; pgvector's `vector` type and HNSW are
  database-level, making per-schema isolation significantly harder.
- Streaming/chunked similarity results, approximate count, or faceted vector search.

## Decisions

### D1: pgvector over a dedicated vector database

**Decision**: Use the pgvector Postgres extension.

**Rationale**: The data plane is already Postgres-first; the extension is already in the governance
catalog and test baseline. Adding a dedicated vector DB (Milvus, Qdrant) would require a new
operator dependency, a new adapter family, a new executor, and a new gateway route family. pgvector
supports HNSW indexes with recall quality comparable to dedicated stores for dimensions under 4096
and row counts under tens of millions — the expected v1 envelope.

**Alternative considered**: Qdrant as a sidecar. Rejected because it requires an additional Helm
chart dependency, a new inter-service protocol (gRPC/HTTP), and cross-service tenant isolation that
must be re-implemented (versus reusing existing RLS).

### D2: HNSW as the default index type, cosine as the default metric

**Decision**: Default to HNSW (`USING hnsw`) with cosine distance (`vector_cosine_ops`).

**Rationale**: HNSW outperforms IVFFlat on recall at equivalent query latency for most v1 use cases
(semantic search, recommendation). It does not require a training/probing step (`lists` parameter
for IVFFlat), so the DDL is simpler and safer. Cosine similarity is the natural metric for
normalised embedding models (OpenAI, Cohere, sentence-transformers), which dominate the market.

**IVFFlat**: Offered as an explicit `indexType` override for operators who need lower build-time
memory. Both `hnsw` and `ivfflat` are accepted, with the metric-to-opclass mapping:
- `cosine` → `vector_cosine_ops`
- `l2` → `vector_l2_ops`
- `inner_product` → `vector_ip_ops`

### D3: KNN plan as a separate path from normalizeOrder

**Decision**: Add a `knn_search` operation with a dedicated `buildKnnSearchPlan` function in the
data-API adapter; do NOT modify `normalizeOrder` in
`services/adapters/src/postgresql-data-api.mjs`.

**Rationale**: `normalizeOrder` (lines 272-299) enforces `column asc/desc` semantics and guards
on the column catalog. Extending it to emit `ORDER BY embedding <=> $1` would require adding a
distance-operator mode that is semantically incompatible with keyset cursors and `between`-style
bounds. A separate KNN plan path isolates the concern and avoids coupling the existing CRUD planner
to vector-specific SQL dialect.

The hybrid filter in the KNN plan reuses `normalizeFilters` and `buildFilterClauses` unchanged
(operators from `POSTGRES_DATA_FILTER_OPERATORS`, lines 26-40), applied as a `WHERE` clause before
the `ORDER BY distance LIMIT k` step.

### D4: RLS-before-ranking for tenant isolation

**Decision**: The KNN query MUST execute under the non-BYPASSRLS `falcone_app` role, relying on
the existing RLS policy (bound to `current_setting('app.current_tenant_id')`) to filter the
candidate set before pgvector ranks by distance.

**Rationale**: This is the same architecture already specified for CRUD in the tenant-isolation
spec. pgvector's HNSW index scan respects the planner's filter pushdown; with RLS active, the
index returns only rows that satisfy the policy predicate. The alternative — a post-ranking
`WHERE tenant_id = $1` filter — could allow cross-tenant rows to enter the ranking step and be
truncated only after ranking, which risks information leakage through the `distance` field of
results near the cut-off boundary.

**Known limitation**: For very large HNSW indexes, per-tenant RLS filtering may reduce recall
below the HNSW ef-search guarantee. This is an accepted trade-off for isolation correctness;
operators requiring higher recall can increase `hnsw.ef_search` per session.

### D5: Pluggable embedding-provider backend pattern

**Decision**: Model the embedding provider backend on the `{ invoke(source, params) }` interface
from `apps/control-plane/src/runtime/functions-executor.mjs::localWorkerBackend` (lines 34-49).
The provider backend exposes `{ embed(text, params) }` and is registered per workspace.

**Rationale**: The functions executor already established this pluggable pattern for dev
(worker_threads) vs. production (Knative). The embedding provider follows the same split: a
`localHttpEmbeddingBackend` for testing (calls a local mock endpoint) and an
`httpEmbeddingBackend` for production (calls the configured provider URL with the resolved secret).
Provider secrets are never stored in plaintext; they are stored as `secretRef` objects resolved
through the Vault + ESO chain already used by `config.secretRefs`.

### D6: database_per_tenant restriction

**Decision**: Vector search is unavailable for `schema_per_tenant` workspaces in v1.

**Rationale**: pgvector types and HNSW indexes are database-level objects. The `vector` type lives
in the `public` schema and cannot be namespaced per tenant within a shared database. Isolated
schema tenants would share the same type, making dimension enforcement and per-tenant index
memory tracking ambiguous. The existing governance catalog already encodes this restriction
(`placementModes: ['database_per_tenant']`); the implementation simply upholds it.

### D7: Default bitnami/postgresql image does NOT include pgvector

**Decision**: Document as a deployment requirement (not a chart change in this proposal) that
operators must configure a pgvector-capable image for dedicated-DB tenant Postgres instances.

**Rationale**: The chart default (`bitnami/postgresql:17.2.0`, `charts/in-falcone/values.yaml`
lines 1698-1699) does not bundle pgvector. Changing the chart default is a deployment concern
outside the scope of this feature proposal. Operators may use `pgvector/pgvector:pg17` or a
custom Bitnami-compatible image with pgvector built in. The provisioning path SHALL emit a
configuration validation error if the resolved image does not advertise pgvector support when a
workspace attempts to enable the `vector` extension.

## Risks / Trade-offs

- **Recall degradation under RLS**: RLS filtering reduces the effective candidate pool for HNSW,
  potentially lowering recall. Mitigation: document the `hnsw.ef_search` tuning knob; add it to
  the workspace vector index config.
- **HNSW build time for large indexes**: HNSW build is CPU-intensive and blocks writes during
  index creation by default. Mitigation: use `CREATE INDEX CONCURRENTLY` in the DDL plan.
- **Dimension immutability**: Once a `vector(N)` column is created, the dimension cannot be
  changed without dropping and re-creating the column and index. Mitigation: surface a
  validation error if the user attempts an ALTER COLUMN on a vector column changing its dimension.
- **Provider API key rotation**: Rotating the Vault secret does not trigger a cache flush.
  Mitigation: the embedding backend resolves the secret on every request (no in-process caching).
- **Image gap for dedicated-DB tenants**: Operators who do not configure a pgvector image will
  see `CREATE EXTENSION` fail at runtime. Mitigation: provisioning pre-flight check (D7).

## Migration Plan

1. Deploy the updated control-plane with the new `knn_search` operation and DDL paths; no database
   changes are required for existing tenants.
2. Operators configure a pgvector-capable image for dedicated-DB tenant Postgres instances.
3. Tenants enable the `vector` extension via the governance surface (existing extension-create flow).
4. Tenants add `vector(N)` columns and HNSW indexes via the DDL surface.
5. No rollback complexity: the feature is additive; disabling it requires only removing the
   extension (DROP EXTENSION vector CASCADE, which also drops dependent columns and indexes).

## Open Questions

- Should `CREATE INDEX CONCURRENTLY` be the default (non-blocking) or should the DDL plan
  use a blocking `CREATE INDEX` (simpler, safer for small datasets)?
- What is the v1 default `max_vector_dimension` quota? (OpenAI text-embedding-3-large = 3072;
  a reasonable default cap might be 4096.)
- Should the search route support a `select` field list to project only specific scalar columns
  alongside the distance, or always return all columns?
