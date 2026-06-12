## Why

The `add-vector-search` change shipped `createEmbeddingProviderStore` and `createEmbeddingExecutor` in
`apps/control-plane/src/runtime/embedding-executor.mjs`, but `main.mjs` (lines 84-87) never constructs
or passes an `embeddingExecutor` to `createControlPlaneServer` — so the `PUT/DELETE
/v1/workspaces/{id}/embedding-provider` routes and `queryText` KNN always hit the
`EMBEDDING_DISABLED` 501 guard in `server.mjs::runEmbeddingProvider` (line 401). Additionally,
`createEmbeddingProviderStore` (line 84 of `embedding-executor.mjs`) is backed by `new Map()` — provider
config is lost on restart and is invisible to the second replica (`controlPlaneExecutor.replicas: 2` in
`charts/in-falcone/values.yaml` line 2405). In-platform embedding is therefore non-functional in the
running control-plane.

## What Changes

- **`createEmbeddingProviderStore` gains a Postgres-backed implementation** mirroring
  `api-keys.mjs::createApiKeyStore` (pool + `ensureSchema()` + `CREATE TABLE IF NOT EXISTS
  workspace_embedding_providers`, upsert/get/delete). When `pool` is provided the store persists to
  Postgres; when omitted it falls back to the existing in-memory `Map` (test seam preserved).
- **`main.mjs` constructs an `embeddingExecutor`** using the Postgres-backed store on the
  shared `keyPool` (`CONTROL_DB_URL ?? dataDsn`, already used by `apiKeyStore`), plus a
  `secretResolver` stub (resolves env-injected secrets; Vault/ESO resolves at the pod level via
  mounted files). The executor is passed as `embeddingExecutor` to `createControlPlaneServer`.
- **`main.mjs` shutdown** adds `await embeddingExecutor?.store?.pool?.end()` (or reuses `keyPool`
  end if the same pool instance is shared).
- **`createEmbeddingProviderStore` schema** records `tenant_id` for future row-level scoping and
  uses `(tenant_id, workspace_id)` as the unique key; secrets are stored as `secretRef` JSON
  only — the plaintext key is NEVER written.
- The re-index `warning` returned by `deployProvider` when a provider is replaced is preserved.
- No new routes; the existing `PUT/DELETE /v1/workspaces/{id}/embedding-provider` routes in
  `services/gateway-config/public-route-catalog.json` (lines 147, 152) are unchanged.

## Capabilities

### New Capabilities
_(none — this change wires and hardens an existing, already-shipped capability)_

### Modified Capabilities
- `functions`: the embedding-provider persistence requirement gains durability and cross-replica
  consistency guarantees; the existing `PUT /v1/workspaces/{id}/embedding-provider` scenario
  requires Postgres backing, not an in-memory Map.
- `vector-search`: the `queryText` KNN scenario requires a functioning embedding executor wired in
  `main.mjs`; adds a durability-across-restart scenario and a cross-replica consistency scenario.

## Impact

- **`apps/control-plane/src/runtime/embedding-executor.mjs`** — `createEmbeddingProviderStore`
  gains an optional `pool` parameter; when present it issues `ensureSchema()` + SQL upsert/get/delete
  against a `workspace_embedding_providers` table. Existing tests that call the no-arg form get the
  in-memory path (no regression).
- **`apps/control-plane/src/runtime/main.mjs`** (lines 84-107) — adds import of
  `createEmbeddingExecutor`, constructs it with the Postgres-backed store, passes it to
  `createControlPlaneServer`, and ends the pool in `shutdown()`.
- **Postgres schema** — one new table `workspace_embedding_providers` (columns: `tenant_id`,
  `workspace_id`, `provider_type`, `model`, `endpoint`, `dimension`, `secret_ref` jsonb,
  `updated_at`). Uses the `CONTROL_DB_URL ?? dataDsn` pool already used by `workspace_api_keys`.
- **`tests/env/executor/`** — new real-stack test
  `embedding-provider-persistence.test.mjs` that writes a provider via one store instance, creates
  a second store on the same pool (simulating a second replica), and asserts the provider is
  readable from the second instance. Needs only plain Postgres (no pgvector required). Wired into
  `tests/env/executor/run.sh`.
- **No gateway or chart changes required.** `controlPlaneExecutor.replicas: 2` (`values.yaml`
  line 2405) is the motivation; no values need updating.
- **Breaking changes**: none — the store interface is backward-compatible; existing unit tests
  that create a no-arg `createEmbeddingProviderStore()` continue to get the in-memory path.
