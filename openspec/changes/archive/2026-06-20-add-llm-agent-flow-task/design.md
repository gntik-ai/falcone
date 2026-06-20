## Context

The platform's BYOK embedding provider (`apps/control-plane/src/runtime/embedding-executor.mjs`) establishes the canonical pattern for tenant-scoped, secret-reference-only provider configuration: a Postgres-backed store persisting only a `secretRef` (never a plaintext key), a `secretResolver` reading `process.env[secretRef.name]` (ESO/Vault-mounted), lazy `CREATE TABLE IF NOT EXISTS` schema (no migration file), and a `(tenant_id, workspace_id) UNIQUE` constraint with a `TENANT_SENTINEL` fallback for single-tenant callers. The executor routes (`PUT/GET/DELETE /v1/workspaces/{ws}/embedding-provider`) are served by `falcone-cp-executor` and reach it via a dedicated APISIX route `2003-embedding` (priority 337) that pre-empts the generic `/v1/workspaces/*` catch-all (route `2003`, priority 335).

No first-party LLM task type exists. `services/workflow-worker/src/activities/catalog-names.mjs` lists `TASK_TYPE_NAMES` as a frozen array of seven names; `apps/control-plane/src/runtime/flow-task-types.mjs` (`buildTaskTypeCatalog`) enforces that the descriptor id-set equals `TASK_TYPE_NAMES` at load time — any drift throws. The activity shape to mirror is `services/workflow-worker/src/activities/functions-invoke.mjs`: a thin async function that validates tenant context, checks `deps.executeFunctions` is wired (throws non-retryable `CAPABILITY_UNAVAILABLE` otherwise), calls the injected executor, and returns `{ status: 'success', ... }`. Worker-level executor injection lives in `services/workflow-worker/src/worker-deps.mjs` (`wireActivityDeps`).

## Goals / Non-Goals

**Goals:**
- Provide a first-party `llm.complete` flow task type with BYOK provider configuration, model allow-listing, secret injection, streaming, and per-tenant/workspace token metering — all mirroring the embedding-provider pattern.
- Ensure the `buildTaskTypeCatalog` invariant holds after the change (no load-time throw).
- Register APISIX routes so the LLM subpaths reach the executor rather than falling through to the control-plane.

**Non-Goals:**
- Semantic chunking, retrieval-augmented generation, or vector search integration — these are separate capabilities.
- Per-tenant LLM rate limiting (tracked as a quota-plans follow-up).
- Agent loop / multi-turn execution orchestration — the `llm.complete` task is a single-turn activity.
- Bringing up a real LLM provider on the kind test cluster — the `localMockLlmBackend` is the test seam.

## Decisions

### 1. Mirror the embedding-executor pattern verbatim (`llm-executor.mjs`)

`apps/control-plane/src/runtime/llm-executor.mjs` is structured exactly like `embedding-executor.mjs`:
- `localMockLlmBackend()` — deterministic mock returning fixed content and token counts; used by tests and local dev (no external call).
- `httpLlmBackend({ providerType, endpoint, allowedModels, defaultModel, resolveSecret, fetchImpl })` — calls the OpenAI-compatible `/chat/completions` endpoint; `resolveSecret` is called per request (no caching); returns `{ content, usage, model }`.
- `createLlmProviderStore({ pool })` — Postgres-backed (falls back to in-memory without a pool); table `workspace_llm_providers`; `(tenant_id, workspace_id) UNIQUE`; `deployProvider` strips `apiKey`/`secret` at write time; `getProvider` returns the stored row (no key resolution).
- `createLlmUsageStore({ pool })` — table `workspace_llm_usage`; `recordUsage(tenantId, workspaceId, model, usage)` inserts a row; `getRollup(tenantId, workspaceId)` aggregates by model using `SUM` — both queries include `tenant_id = $1 AND workspace_id = $2` predicates.
- `createLlmExecutor({ providerStore, usageStore, secretResolver, backendFactory, fetchImpl })` — composes the store and backends; `complete` enforces the allow-list before the backend call, calls `backendFactory` to get a backend, calls the backend, records usage, and returns `{ content, usage, model }`.

Both tables are created lazily at executor boot via `CREATE TABLE IF NOT EXISTS`; no migration file is needed (same rationale as `workspace_embedding_providers`).

Evidence: `apps/control-plane/src/runtime/embedding-executor.mjs::createEmbeddingProviderStore`, `apps/control-plane/src/runtime/embedding-executor.mjs::createPostgresProviderStore`, `apps/control-plane/src/runtime/main.mjs::secretResolver`.

### 2. Five new executor server routes (`server.mjs`)

`apps/control-plane/src/runtime/server.mjs` registers five new routes served by `runLlmProvider` / `runLlmComplete` / `runLlmUsage` (analogous to `runEmbeddingProvider`):
- `PUT /v1/workspaces/:workspaceId/llm-provider`
- `GET /v1/workspaces/:workspaceId/llm-provider`
- `DELETE /v1/workspaces/:workspaceId/llm-provider`
- `POST /v1/workspaces/:workspaceId/llm/completions`
- `GET /v1/workspaces/:workspaceId/llm-usage`

Auth follows the existing executor pattern (`resolveIdentity` from the JWT/API key, `tenantId` injected into the store calls).

Evidence: `apps/control-plane/src/runtime/server.mjs::runEmbeddingProvider`.

### 3. Boot wiring (`main.mjs`)

`apps/control-plane/src/runtime/main.mjs` adds:
```js
secretResolver: (secretRef) => secretRef?.name ? process.env[secretRef.name] : null
```
(already present for embedding; shared or duplicated by reference), creates `createLlmExecutor` bound to the metadata `keyPool`, and calls `llmExecutor.ensureSchema()` in the boot retry block alongside the embedding schema init.

Evidence: `apps/control-plane/src/runtime/main.mjs::secretResolver`, `apps/control-plane/src/runtime/main.mjs::ensureSchema`.

### 4. APISIX route `2003-llm` (priority 338)

A new route block in `deploy/kind/apisix/apisix.yaml` with `id: "2003-llm"`, `uri: "/v1/workspaces/*"`, `priority: 338` (above `2003-embedding` at 337 and `2003` at 335), `vars: [["uri", "~~", "^/v1/workspaces/[^/]+/(llm-provider|llm/completions|llm-usage)"]]`, mirroring the `2003-embedding` block verbatim (strip identity headers, inject `x-gateway-auth`, upstream `falcone-cp-executor:8080`).

Evidence: `deploy/kind/apisix/apisix.yaml::2003-embedding` (lines 471–491).

### 5. Catalog-names + descriptor invariant

`TASK_TYPE_NAMES` in `services/workflow-worker/src/activities/catalog-names.mjs` gains `'llm.complete'`. `DESCRIPTORS` in `apps/control-plane/src/runtime/flow-task-types.mjs` gains a descriptor with `id: 'llm.complete'`, `label: 'LLM Complete'`, `category: 'ai'`, and an `inputSchema` with required `model` (string) and `messages` (array), optional `prompt` (string, `x-falcone-expression: true`), `system` (string, `x-falcone-expression: true`), `maxTokens` (integer), `temperature` (number). Both additions happen in the same change to keep the `buildTaskTypeCatalog` invariant green.

Evidence: `services/workflow-worker/src/activities/catalog-names.mjs::TASK_TYPE_NAMES`, `apps/control-plane/src/runtime/flow-task-types.mjs::buildTaskTypeCatalog`.

### 6. `llm-complete.mjs` activity (mirrors `functions-invoke.mjs`)

`services/workflow-worker/src/activities/llm-complete.mjs` exports `llmComplete(input, deps)`. Structure:
1. `assertPayloadSize(input, 'input')`.
2. Validate `tenant.tenantId` and `workspaceId` (non-retryable `UNAUTHENTICATED` if missing).
3. Validate `deps.executeLlmComplete` is a function (non-retryable `CAPABILITY_UNAVAILABLE`).
4. Call `deps.executeLlmComplete({ model, messages, prompt, system, maxTokens, temperature, tenantId, workspaceId })`.
5. On `MODEL_NOT_ALLOWED` from the executor, re-throw non-retryable.
6. Return `{ status: 'success', content, usage, model }`.
7. `assertPayloadSize(output, 'output', MAX_OUTPUT_BYTES)`.

Evidence: `services/workflow-worker/src/activities/functions-invoke.mjs::functionsInvoke`.

### 7. Worker-deps wiring (`worker-deps.mjs`)

`wireActivityDeps` gains an additional dynamic import of `apps/control-plane/src/runtime/llm-executor.mjs` and creates an in-process `executeLlmComplete` bound to the worker `keyPool` and the env `secretResolver` — the same pattern used for `executePostgresData`.

Evidence: `services/workflow-worker/src/worker-deps.mjs::wireActivityDeps`.

### 8. Temporal-not-live-on-kind verification note

On the kind test cluster (`test-cluster-b`) Temporal is NOT running (memory note `test-cluster-b-access-and-topology.md`). The flow **execution** path (`llm.complete` Temporal activity dispatch) is therefore verified via unit and contract tests only. However, the BYOK provider configuration plane (`PUT/GET/DELETE /v1/workspaces/{ws}/llm-provider`), the completion endpoint (`POST /v1/workspaces/{ws}/llm/completions`), and the usage rollup (`GET /v1/workspaces/{ws}/llm-usage`) are served directly by the executor (no Temporal dependency) and are **live-verifiable on the kind cluster** using `localMockLlmBackend` or a real provider with a valid `secretRef`. The `buildTaskTypeCatalog` invariant and FLW-E006 validation are verifiable via blackbox/contract tests without Temporal.

### 9. Why `workflows` capability owns this

The new `llm.complete` task type is a direct extension of the flow task-type catalog (`TASK_TYPE_NAMES` / `DESCRIPTORS` / `buildTaskTypeCatalog`). The BYOK provider configuration and usage metering are the supporting infrastructure that make the activity safe and auditable per workspace — exactly parallel to how the embedding provider supports the `db.query` vector path within the `vector-search` capability. The consumer surface (the DSL task node, the catalog, the Temporal activity) belongs unambiguously to `workflows`.

## Risks / Trade-offs

- **Usage store `SUM` race**: concurrent completions may produce interleaved `INSERT` rows, but `SUM` aggregation is correct under concurrent writes (no `FOR UPDATE` needed on the usage table).
- **Mock backend in tests**: the `localMockLlmBackend` returns fixed token counts; tests that assert metering use it and assert on the fixed values — a deliberate trade-off for determinism.
- **`allowedModels` enforcement in both activity and HTTP layer**: the model check runs in the HTTP completion endpoint (for direct callers) and again in the `llm.complete` Temporal activity (for flow callers). Duplication is intentional — defense in depth.
- **No per-tenant LLM rate limiting in this change**: rate limiting is deferred to the quota-plans capability. Until then a single tenant could make unbounded completion calls.
