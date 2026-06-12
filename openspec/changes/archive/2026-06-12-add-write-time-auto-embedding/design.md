## Context

The `add-embedding-provider-persistence` change (archived at
`openspec/changes/archive/2026-06-11-add-embedding-provider-persistence/`) made the embedding
provider durable (Postgres-backed `workspace_embedding_providers` table on `keyPool`) and wired
`embeddingExecutor` into `main.mjs`. The `add-vector-search` change wired the executor into the
KNN `queryText` read path at lines 175-181 of
`apps/control-plane/src/runtime/postgres-data-executor.mjs`.

Write-time auto-embedding is the natural complement: insert/update calls currently have no way
to auto-populate a `vector(N)` column from a source text field without the client computing the
embedding. This change adds that capability by mirroring the existing read-path hook onto the
write path, gated by a new per-collection mapping record.

All the necessary infrastructure already exists:
- `embeddingExecutor.embedForWorkspace` (embedding-executor.mjs line 269).
- `columnVectorDimension` (postgres-data-executor.mjs line 55).
- `table.vectorColumns` introspection (postgres-data-executor.mjs line 48).
- The `[a,b,c]` vector literal binding at postgresql-data-api.mjs lines 1870-1872.
- The `keyPool` metadata pool shared between `apiKeyStore` and `embeddingStore`.

## Goals / Non-Goals

**Goals:**
- Operators configure a per-collection embedding mapping (source text column → target vector
  column) via a simple PUT route; the mapping is stored durably in Postgres and scoped by
  `(tenant_id, workspace_id, schema_name, table_name, target_column)`.
- `insert`, `bulk_insert`, and `update` auto-populate the target vector column when a mapping is
  found and the target is not explicitly provided.
- Explicit target vectors are respected (no override).
- Dimension mismatch (provider dimension ≠ column declared N) is rejected with 422 atomically;
  no partial write.
- Provider missing → fail closed with 422 `EMBEDDING_PROVIDER_MISSING`, consistent with the read
  path.
- Tenant isolation is preserved: mapping lookup is scoped to the verified `tenantId`.
- pgvector / dedicated-DB only — consistent with the vector-search capability.
- Real-stack test suite on the pgvector image proves the insert → KNN round-trip.

**Non-Goals:**
- Automatic re-embedding of existing rows when a provider or mapping is changed.
- Embedding quota metering (deferred).
- Support for non-Postgres (Mongo) data stores.
- Client-side embedding (unchanged).
- Embedding of non-text fields.

## Decisions

### D1: Mapping store mirrors the provider store

**Decision**: Add `createEmbeddingMappingStore({ pool? })` to
`apps/control-plane/src/runtime/embedding-executor.mjs`, following the same dual pattern as
`createEmbeddingProviderStore`:
- No pool → in-memory `Map` keyed by `${workspaceId}:${schemaName}:${tableName}:${targetColumn}`.
- Pool provided → Postgres `workspace_embedding_mappings` table with `ensureSchema()`.

```sql
CREATE TABLE IF NOT EXISTS workspace_embedding_mappings (
  tenant_id      text NOT NULL,
  workspace_id   text NOT NULL,
  schema_name    text NOT NULL,
  table_name     text NOT NULL,
  target_column  text NOT NULL,
  source_column  text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, schema_name, table_name, target_column)
);
CREATE INDEX IF NOT EXISTS idx_wem_lookup
  ON workspace_embedding_mappings (tenant_id, workspace_id, schema_name, table_name);
```

The key is `(tenant_id, workspace_id, schema_name, table_name, target_column)` — a table can have
multiple vector columns each with its own independent mapping. Provider and model come from the
workspace embedding provider, not the mapping.

**Rationale**: One-to-one structural parity with the provider store makes the pattern obvious,
reuses all the `tenantId` scoping logic, and shares the `keyPool` pool (same low-QPS mapping
config workload).

### D2: Write-path hook placement

**Decision**: In `executePostgresData`, insert the hook immediately after the table introspection
(`await introspectTable`) and before `buildRequest`, inside the `registry.withWorkspaceClient`
callback. This is the exact counterpart of the KNN `queryText` block at lines 175-181.

```
introspectTable(...)
  ↓
// [KNN read: queryText → embedForWorkspace → knnParams.queryVector]
// [NEW: write: mapping lookup → embedForWorkspace → values/rows/changes patched]
  ↓
buildRequest(...)
  ↓
plan.sql.text executed
```

The hook mutates a shallow copy of `params.values` / each row in `params.rows` / `params.changes`
rather than the original params object, so no caller-visible mutation occurs.

For `bulk_insert` the hook iterates over every row. If any `embedForWorkspace` call rejects (e.g.
dimension mismatch, provider missing), the error propagates before any SQL is issued — the whole
batch is rejected and no rows are written. This is atomic by construction (the error exits before
`buildRequest`, let alone `client.query`).

For `update`, the hook fires only when `params.changes` contains the source column key AND does
NOT contain the target column key.

### D3: Vector-insert binding — integration risk and proof

**Risk**: When a pgvector `vector(N)` column receives an INSERT value from the auto-embed hook,
the value is a JavaScript string `"[a,b,c,...]"`. The existing KNN path binds this as a
`pushValue(values, vectorLiteral, 'vector')` with an explicit `::vector` cast (postgresql-data-api.mjs
lines 1870-1872). However, for the insert/update path the plan builder uses the generic column
binder (`buildColumnAssignments`, `buildInsertValues`) — it is not guaranteed to cast vector-type
columns to `::vector`.

**Mitigation**: The real-stack test (see D5) must prove that an INSERT with the auto-embedded
vector literal string actually succeeds against a live pgvector Postgres. If the generic binder
does not produce the cast, the implementer must extend the insert binder to detect `vector`-typed
columns (already flagged in `table.columns[].vector === true` from `introspectTable`) and emit a
`$N::vector` parameter binding. This is the single integration risk flagged in this design; the
test is the proof gate before the route goes live.

**Resolution (implemented): the LITERAL path — no binder change.** The real-stack round-trip
(`auto-emb-01`/`auto-emb-02`) proves that a `[a,b,c]` literal string bound as `$N` with NO cast
coerces correctly into a `vector(N)` column on INSERT, UPDATE, and bulk INSERT. Postgres applies
the assignment cast (text → vector) because the target column type is statically known in those
statements; a wrong-dimension literal fails with pgvector's native `expected N dimensions` error
(mapped to 422). The hook therefore sets `row[targetColumn]` to the `[a,b,c]` literal produced by
`vectorLiteral(vector)` and relies on the existing generic binder in
`services/adapters/src/postgresql-data-api.mjs` — that file is UNCHANGED. The insert→KNN
round-trip is the gate and it is green.

### D4: Explicit-value precedence

If the caller's payload already contains the target column:
- `insert`: `params.values[targetColumn]` is non-null/undefined → skip hook.
- `bulk_insert`: per-row check — skip hook for rows that already supply the target.
- `update`: `params.changes[targetColumn]` present → skip hook.

This allows callers to supply a pre-computed embedding (e.g. from a specialised model) while
still getting auto-embedding for rows that omit it.

### D5: Test strategy

**Real-stack tests** (`tests/env/executor/auto-embedding-write.test.mjs`, pgvector image):
1. Configure provider (mock backend, dimension 8) + mapping (sourceColumn `body`, targetColumn
   `embedding`).
2. INSERT `{ body: "hello" }` → assert `embedding` column populated (non-null, 8-dimensional).
3. KNN search → asserts inserted row is returned (proves the vector is correctly stored and indexed).
4. INSERT with explicit `embedding` vector → assert stored vector matches the provided value, NOT
   the auto-generated one (explicit-value precedence).
5. BULK INSERT 3 rows each with `body` → assert all 3 rows have distinct `embedding` values.
6. UPDATE changing `body` → assert `embedding` changes; UPDATE omitting `body` → assert
   `embedding` unchanged.
7. Provider missing → INSERT with source text → assert 422 `EMBEDDING_PROVIDER_MISSING`, 0 rows.
8. Cross-tenant probe: tenant A has a mapping; tenant B inserts under the same workspaceId/table
   with no mapping for tenant B → no auto-embed fires; tenant B's row has NULL `embedding`.

**Blackbox tests** (`tests/blackbox/auto-embedding-write.test.mjs`):
- Mapping CRUD routes (PUT, GET, DELETE) return correct HTTP status codes.
- Auto-embed path with mock `embeddingExecutor` (no pool needed): insert → `embedForWorkspace`
  called once; explicit vector → `embedForWorkspace` NOT called.
- Dimension mismatch → 422 before SQL.
- Provider missing → 422 `EMBEDDING_PROVIDER_MISSING`.

**Unit tests**: `createEmbeddingMappingStore()` no-pool (in-memory CRUD, `ensureSchema` noop).

All real-stack tests are wired into `tests/env/executor/run.sh`.

### D6: Route design

Four routes under the Postgres data prefix (`^/v1/postgres/workspaces/([^/]+)/data/([^/]+)/schemas/([^/]+)/tables/([^/]+)`):

| Method | Path suffix | Description |
|--------|-------------|-------------|
| PUT | `/embedding-mapping` | Configure (upsert) a mapping for the table |
| GET | `/embedding-mapping` | Retrieve the current mapping for the table |
| DELETE | `/embedding-mapping` | Remove the mapping for the table |

Body for PUT: `{ "sourceColumn": "body", "targetColumn": "embedding" }`.

These are added to `services/gateway-config/public-route-catalog.json` with
`privilege_domain: "structural_admin"` (consistent with the `embedding-provider` routes at
lines 147-154 of the catalog — mapping config is operator-level structural configuration).

### D7: main.mjs wiring

After constructing `embeddingStore` (line 63 of `main.mjs`):

```js
import { createEmbeddingMappingStore } from './embedding-executor.mjs';
const mappingStore = createEmbeddingMappingStore({ pool: keyPool });
```

Add `mappingStore.ensureSchema()` to the startup `Promise.all`. Pass `mappingStore` to
`createControlPlaneServer`. The shared `keyPool.end()` in `shutdown()` covers this store.

## Risks / Trade-offs

- **Vector-insert binding** (D3): the generic insert binder may not cast `vector` columns. A
  failing real-stack test is the gate; the fix is a small targeted extension to the insert binder
  to emit `$N::vector` when the column has `vector: true`.
- **Per-row embedding latency in bulk_insert**: each row calls `embedForWorkspace` sequentially.
  For large batches this adds N × provider round-trip latency. Parallelising with
  `Promise.all` is a follow-up optimisation; for v1 sequential is simpler and avoids
  provider-side rate-limiting.
- **Schema init**: `ensureSchema()` runs at startup before `listen`, same as the provider store.
  If the DB is unavailable, the server does not start — acceptable fail-fast behaviour.
- **Pool contention**: mapping store shares `keyPool` (max 4). Mapping lookups happen on every
  write to a mapped table; the query is a single indexed row lookup
  (`idx_wem_lookup` covering `(tenant_id, workspace_id, schema_name, table_name)`). Contention
  is negligible at expected QPS; a dedicated pool can be introduced without API changes.
- **No re-indexing on mapping change**: replacing or deleting a mapping does not re-embed existing
  rows. A `warning` field (mirroring the provider store's `REINDEX_WARNING`) informs the operator
  that existing rows were generated by the previous mapping.
