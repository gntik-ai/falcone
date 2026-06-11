## T01: Confirm baseline green

- [x] Run `bash tests/blackbox/run.sh` and `bash tests/env/executor/run.sh` and record that both
  pass before any changes are made. This is the green baseline.

**Evidence**: `tests/blackbox/vector-search-embedding.test.mjs` (bbx-vec-emb-01..09) covers the
existing in-memory store; `tests/env/executor/vector-search-knn-rls.test.mjs` covers KNN RLS.
The `PUT/DELETE /v1/workspaces/{id}/embedding-provider` routes CURRENTLY return 501 in the
running control-plane (`main.mjs` omitted `embeddingExecutor`); this is the bug this change fixes.
Baseline: blackbox 340 pass; executor real-stack 44 pass.

## T02: Add failing real-stack persistence test (test-first)

- [x] Create `tests/env/executor/embedding-provider-persistence.test.mjs`.
- [x] Confirm the test FAILS before T03 (no pool support yet) and PASSES after T03.
- [x] Wire the new file into `tests/env/executor/run.sh`.

Scenarios (numbered as `emb-persist-01` through `emb-persist-07`):

- `emb-persist-01`: `deployProvider` on store S1 inserts a row into `workspace_embedding_providers`.
- `emb-persist-02`: A second store S2 on the same pool reads the same row (cross-instance read).
- `emb-persist-03`: `removeProvider` on S1 deletes the row; S2 subsequently returns `null`.
- `emb-persist-04`: Replacing an existing provider (second `deployProvider` call to same
  workspace) returns a `warning` field.
- `emb-persist-05`: `secret_ref` column contains the `secretRef` object; no plaintext key.
- `emb-persist-06`: Two different workspaces under different `tenant_id` values are stored
  independently (no cross-tenant leakage between rows).
- `emb-persist-07`: `ensureSchema()` is idempotent — calling it twice does not error.

**Note**: This test requires only plain Postgres; pgvector is NOT needed. The after-hook uses a
plain (non-FORCE) `DROP DATABASE IF EXISTS` to avoid the async-after-teardown flake; the
before-hook keeps FORCE.

## T03: Extend `createEmbeddingProviderStore` with Postgres persistence

File: `apps/control-plane/src/runtime/embedding-executor.mjs`

- [x] Change signature to `createEmbeddingProviderStore({ pool } = {})`.
- [x] When `pool` is falsy, return the existing in-memory `Map` implementation unchanged.
- [x] When `pool` is provided:
  - [x] Add `async ensureSchema()` creating `workspace_embedding_providers`
    (`tenant_id`, `workspace_id`, `provider_type`, `model`, `endpoint`, `dimension`,
    `secret_ref jsonb`, `updated_at`, `UNIQUE (tenant_id, workspace_id)`) +
    `idx_wep_workspace` on `(workspace_id)`.
  - [x] `deployProvider(workspaceId, config)`: strip `apiKey`/`secret`, check for an existing row
    (scoped to `(tenant_id, workspace_id)`) to set `warning`, then upsert via
    `INSERT ... ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET ...`. `tenantId` is taken from
    `config.tenantId` or falls back to a NOT NULL sentinel so the UNIQUE constraint holds.
  - [x] `getProvider(workspaceId, tenantId?)`: scoped to `(tenant_id, workspace_id)` when a tenant
    is supplied, otherwise `WHERE workspace_id = $1 LIMIT 1` (covered by `idx_wep_workspace`).
    Returns a plain record or `null`.
  - [x] `removeProvider(workspaceId, tenantId?)`: `DELETE ... RETURNING workspace_id`; returns
    `{ removed: rowCount > 0 }`.
- [x] Existing unit tests that call `createEmbeddingProviderStore()` (no pool) keep working — the
  no-arg code path is the same in-memory Map as before. The in-memory path now also accepts an
  optional `tenantId`/`endpoint` in config for parity (ignored for the in-memory key).
- [x] Share the re-index warning string (`REINDEX_WARNING`) between both store implementations.

## T04: Wire `embeddingExecutor` into `main.mjs`

File: `apps/control-plane/src/runtime/main.mjs`

- [x] Import `createEmbeddingProviderStore` and `createEmbeddingExecutor` from
  `./embedding-executor.mjs`.
- [x] After constructing `keyPool` and `apiKeyStore`, build
  `const embeddingStore = createEmbeddingProviderStore({ pool: keyPool })` and
  `const embeddingExecutor = createEmbeddingExecutor({ store: embeddingStore, secretResolver })`
  where `secretResolver(secretRef)` resolves `process.env[secretRef.name]` (ESO/Vault mounts the
  resolved secret as an env var; only the `secretRef` is ever persisted).
- [x] Pass `embeddingExecutor` in the `createControlPlaneServer(...)` call.
- [x] Run both schema inits in parallel via
  `Promise.all([apiKeyStore.ensureSchema(), embeddingStore.ensureSchema()])` before `listen`.
- [x] `keyPool.end()` in `shutdown()` already covers the shared pool; no additional teardown.

## T05: Verify `PUT/DELETE /v1/workspaces/{id}/embedding-provider` are operational (not 501)

- [x] Add black-box tests (`tests/blackbox/embedding-provider-persistence.test.mjs`) that drive
  the public HTTP surface: construct `createControlPlaneServer` with an `embeddingExecutor` and
  assert `PUT/DELETE .../embedding-provider` return 200 (the 501 guard does NOT fire), the stored
  record exposes only a `secretRef`, replacement returns the re-index warning, and — with NO
  executor wired — the routes return 501 `EMBEDDING_DISABLED`. Also assert the `queryText` KNN
  path (`embedForWorkspace`) is operational with a configured provider and returns 422
  `EMBEDDING_PROVIDER_MISSING` (not 501) when none is configured.
- [x] The route handlers inject the verified identity's `tenantId` (never the body) so the store
  keys by `(tenant_id, workspace_id)`; the KNN path threads `tenantId` through
  `embedForWorkspace` → `resolveBackend` → `getProvider`.

Labels: `bbx-emb-persist-01` through `bbx-emb-persist-06`.

## T06: Run full test suites and confirm green

- [x] `bash tests/blackbox/run.sh` — all existing bbx-vec-emb-* tests still pass (in-memory path
  unchanged); new bbx-emb-persist-* tests pass. (346 pass)
- [x] `bash tests/env/executor/run.sh` — `embedding-provider-persistence.test.mjs`
  (emb-persist-01..07) and `vector-search-knn-rls.test.mjs` both pass. (51 pass)
- [x] `npm run test:unit` (553 pass / 1 pre-existing skip), `npm run test:adapters` (104 pass),
  `npm run test:contracts` (214 pass / 17 pre-existing skips) — no regressions.
- [x] `npm run lint` — clean.
- [x] `openspec validate add-embedding-provider-persistence --strict` — clean.
