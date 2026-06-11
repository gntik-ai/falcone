## Context

The `add-vector-search` change (archived at
`openspec/changes/archive/2026-06-11-add-vector-search/`) implemented embedding-provider
management in `apps/control-plane/src/runtime/embedding-executor.mjs` but left two gaps that make
in-platform embedding non-functional in production:

1. **`main.mjs` never wires `embeddingExecutor`** (lines 84-87 construct `createControlPlaneServer`
   with no `embeddingExecutor` argument). `server.mjs::runEmbeddingProvider` (line 401) therefore
   throws `EMBEDDING_DISABLED` (501) on every embedding-provider route hit, and the
   `queryText` KNN path in the `POST .../search` handler (line 244) also receives `undefined`.

2. **`createEmbeddingProviderStore()` (line 84 of `embedding-executor.mjs`) is backed by
   `new Map()`** — provider configuration is lost on restart and is not shared across the two
   executor replicas (`controlPlaneExecutor.replicas: 2` in `charts/in-falcone/values.yaml`
   line 2405).

## Goals / Non-Goals

**Goals:**
- Make `PUT/DELETE /v1/workspaces/{id}/embedding-provider` and `queryText` KNN operational in the
  running control-plane.
- Persist provider config durably in Postgres, sharing the metadata pool used by `apiKeyStore`.
- Preserve the in-memory store as a test seam (no-arg construction).
- Keep the re-index warning behaviour intact when a provider is replaced.
- Add a real-stack persistence test that proves cross-instance visibility.

**Non-Goals:**
- Secret rotation or Vault integration changes (the existing per-request secret resolution is
  correct; this change does not touch it).
- Embedding quota metering (deferred to a future `add-embedding-quota` change).
- Provider endpoint health-checking or circuit-breaking.
- Automatic re-embedding on provider replacement.

## Decisions

### D1: Mirror `createApiKeyStore` for `createEmbeddingProviderStore`

**Decision**: Add an optional `{ pool }` parameter to `createEmbeddingProviderStore`. When `pool`
is provided, the store uses Postgres (`ensureSchema()` + `CREATE TABLE IF NOT EXISTS
workspace_embedding_providers`); when omitted it falls back to the existing in-memory `Map`.

**Rationale**: `apps/control-plane/src/runtime/api-keys.mjs::createApiKeyStore` already
establishes this pattern (lines 32-121): `ensureSchema()` creates the table idempotently, and
all CRUD is plain `pool.query` parameterised SQL. Reusing the same pool
(`process.env.CONTROL_DB_URL ?? dataDsn` — line 54 of `main.mjs`) avoids a second connection
pool and keeps schema migrations consistent. The in-memory fallback preserves all existing unit
tests without modification.

**Alternative considered**: A separate `EMBEDDING_DB_URL` env var. Rejected — there is no
operational reason to put embedding config on a different DB; the metadata pool is lightly loaded
and the table is tiny (one row per workspace).

### D2: Table design — `workspace_embedding_providers`

```sql
CREATE TABLE IF NOT EXISTS workspace_embedding_providers (
  tenant_id      text NOT NULL,
  workspace_id   text NOT NULL,
  provider_type  text,
  model          text,
  endpoint       text,
  dimension      integer,
  secret_ref     jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_wep_workspace
  ON workspace_embedding_providers (workspace_id);
```

Key points:
- `(tenant_id, workspace_id)` is the unique key (one provider per workspace per tenant).
  This matches the identity-scoping pattern in `workspace_api_keys` (tenant_id + workspace_id,
  `api-keys.mjs` line 38).
- `secret_ref` is `jsonb` — stores the `secretRef` object (e.g.
  `{"vaultPath": "secret/ws-abc/openai-key"}`) without interpreting it. The in-memory store
  currently stores whatever `safe.secretRef` is; `jsonb` preserves arbitrary key shapes.
- `apiKey` / `secret` plaintext fields are stripped in `deployProvider` before writing (already
  done in `embedding-executor.mjs` line 91: `const { apiKey, secret, ...safe } = config`).
- No `id` UUID primary key — the workspace is the natural key; this avoids a surrogate key that
  the API never exposes.

### D3: Upsert pattern for `deployProvider`

Use `INSERT ... ON CONFLICT (tenant_id, workspace_id) DO UPDATE SET ...` so that configuring a
provider is idempotent. The "existing provider" check that triggers the re-index warning reads the
existing row before the upsert (a `SELECT ... FOR UPDATE` or a `RETURNING` xmax trick) — the same
pattern is acceptable at the expected low frequency of provider configuration changes.

### D4: `main.mjs` wiring

In `main.mjs` after constructing `keyPool` (line 54):

```js
import { createEmbeddingExecutor } from './embedding-executor.mjs';
// ...
const embeddingStore = createEmbeddingProviderStore({ pool: keyPool });
const embeddingExecutor = createEmbeddingExecutor({
  store: embeddingStore,
  secretResolver: (secretRef) => {
    // Vault/ESO mounts the resolved secret as an env var or file at the path
    // encoded in secretRef. For now resolve from process.env keyed by secretRef.name.
    if (secretRef?.name) return Promise.resolve(process.env[secretRef.name] ?? null);
    return Promise.resolve(null);
  },
});
```

Pass `embeddingExecutor` to `createControlPlaneServer` (line 85). Add
`embeddingStore.ensureSchema()` alongside `apiKeyStore.ensureSchema()` via
`Promise.all([apiKeyStore.ensureSchema(), embeddingStore.ensureSchema()])`. The pool is
already ended by `keyPool.end()` in `shutdown()` — no additional teardown needed when
both stores share the same pool.

The `PUT/DELETE /v1/workspaces/{id}/embedding-provider` route handlers inject the **verified
identity's** `tenantId` (never a `tenantId` from the request body) so the store keys the record
by `(tenant_id, workspace_id)`. The `queryText` KNN path threads the verified `tenantId` through
`embedForWorkspace(workspaceId, text, { tenantId })` → `resolveBackend(workspaceId, { tenantId })`
→ `store.getProvider(workspaceId, tenantId)`, so a workspaceId shared across two tenants resolves
each tenant's own provider (the Postgres read is scoped to `(tenant_id, workspace_id)`; when no
tenant is supplied — e.g. single-tenant/in-memory test callers — the lookup falls back to
`WHERE workspace_id = $1`). The in-memory store ignores `tenantId` (single-process callers are
already workspace-isolated).

### D5: Test strategy

**Unit tests** (existing `tests/blackbox/vector-search-embedding.test.mjs`): create a
`createEmbeddingProviderStore()` with no pool arg — still in-memory, no regression.

**Real-stack persistence test** (`tests/env/executor/embedding-provider-persistence.test.mjs`):
1. Create `createEmbeddingProviderStore({ pool: testPool })` (instance S1).
2. Call `S1.deployProvider('tenant-a', 'ws-1', { providerType: 'openai', model: 'm', secretRef: { name: 'K' } })`.
3. Create a second instance `S2 = createEmbeddingProviderStore({ pool: testPool })` (same pool,
   no shared in-memory state — simulates a second replica or a restarted process).
4. Assert `S2.getProvider('ws-1')` returns the record written by S1.
5. Assert `S1.removeProvider('ws-1')` returns `{ removed: true }`.
6. Assert `S2.getProvider('ws-1')` returns `null` after deletion.
7. Assert `deployProvider` with an existing record returns the re-index `warning`.

This test requires only plain Postgres (the standard `tests/env` Postgres container); pgvector is
NOT required. Wire into `tests/env/executor/run.sh` alongside the existing executor tests.

## Risks / Trade-offs

- **Schema init on startup**: `ensureSchema()` runs `CREATE TABLE IF NOT EXISTS` synchronously
  before `server.listen` (same pattern as `apiKeyStore.ensureSchema()`, line 89 of `main.mjs`).
  If the DB is unavailable the server does not start — acceptable fail-fast behaviour.
- **Pool sharing**: Reusing `keyPool` for both `apiKeyStore` and `embeddingStore` means the pool
  max (4 connections, line 54) is shared. The embedding store has very low QPS (provider
  configuration is rare); the API-key store is the dominant user. If contention becomes an issue
  a separate pool with `max: 2` can be introduced without API changes.
- **`secretResolver` in main.mjs**: The initial implementation resolves secrets from `process.env`
  keyed by `secretRef.name`. This is correct for ESO-mounted secrets (ESO writes the secret value
  as an env var). Vault agent sidecar injection would follow the same pattern. If a more complex
  resolver is needed it can be swapped without changing the store or executor interfaces.
