## Why

Falcone flows support six first-party task types (`db.query`, `storage.put`, `storage.get`, `functions.invoke`, `events.publish`, `http.request`, `email.send`). No first-party LLM/agent task type exists; the only BYOK surface today is the embedding provider introduced by `add-vector-search`. As LLM-driven automation becomes a primary use case for flow builders, the absence of a first-party `llm.complete` activity forces tenants to approximate LLM calls through `http.request` with no model allow-listing, no secret injection, and no token metering. GitHub issue #640.

## What Changes

- Add APISIX routes for `^/v1/workspaces/[^/]+/(llm-provider|llm/completions|llm-usage)` in `deploy/kind/apisix/apisix.yaml` at higher priority than the generic `/v1/workspaces/*` catch-all route (`2003`, priority 335), routing them to `falcone-cp-executor`, stripping client-supplied identity headers, and injecting `x-gateway-auth` — mirroring the `2003-embedding` route (priority 337).
- Add `apps/control-plane/src/runtime/llm-executor.mjs` implementing:
  - `localMockLlmBackend` — deterministic mock returning fixed content + token counts (test seam, no external calls).
  - `httpLlmBackend({ providerType, endpoint, allowedModels, defaultModel, resolveSecret, fetchImpl })` — calls an OpenAI-compatible `/chat/completions` endpoint; resolves the secret at request time (no caching); rejects models not in `allowedModels` with `MODEL_NOT_ALLOWED` before any provider call; fails closed with `LLM_PROVIDER_SECRET_UNRESOLVED` when `resolveSecret` returns null.
  - `createLlmProviderStore({ pool })` — persists to `workspace_llm_providers` (`CREATE TABLE IF NOT EXISTS`), tenant-scoped `(tenant_id, workspace_id) UNIQUE`; strips plaintext keys at write time; GET returns only `secretRef` (never a resolved key). Mirrors `createEmbeddingProviderStore` from `apps/control-plane/src/runtime/embedding-executor.mjs`.
  - `createLlmUsageStore({ pool })` — persists to `workspace_llm_usage` (`CREATE TABLE IF NOT EXISTS`), tenant-scoped; records `promptTokens`, `completionTokens`, `totalTokens`, `model`, `workspaceId`, `tenantId`, `createdAt`; exposes `recordUsage` and `getRollup` (grouped by model, scoped by `(tenant_id, workspace_id)`).
  - `createLlmExecutor({ providerStore, usageStore, secretResolver, backendFactory, fetchImpl })` — exposes `setProvider`, `getProvider`, `removeProvider`, `complete`, `getUsage`. `complete` enforces the model allow-list, resolves the secret, calls the backend, meters usage, and returns `{ content, usage, model }`. Streaming path proxies SSE tokens and still records usage on the final chunk.
- Extend `apps/control-plane/src/runtime/server.mjs` with routes:
  - `PUT /v1/workspaces/{workspaceId}/llm-provider` (set provider config)
  - `GET /v1/workspaces/{workspaceId}/llm-provider` (get config, no plaintext key)
  - `DELETE /v1/workspaces/{workspaceId}/llm-provider` (remove provider)
  - `POST /v1/workspaces/{workspaceId}/llm/completions` (complete, supports `stream: true`)
  - `GET /v1/workspaces/{workspaceId}/llm-usage` (token-usage rollup)
- Extend `apps/control-plane/src/runtime/main.mjs` to call `llmExecutor.ensureSchema()` at boot alongside the embedding `ensureSchema`, bind the LLM executor to the metadata `keyPool`, and pass `secretResolver: (secretRef) => secretRef?.name ? process.env[secretRef.name] : null` (same pattern as the embedding executor).
- Add `'llm.complete'` to `TASK_TYPE_NAMES` in `services/workflow-worker/src/activities/catalog-names.mjs`.
- Add the `llm.complete` descriptor to `DESCRIPTORS` in `apps/control-plane/src/runtime/flow-task-types.mjs` (category `ai`, inputSchema: required `model` + `messages`, optional `prompt`/`system`/`maxTokens`/`temperature`; expression-enabled string fields).
- Add `services/workflow-worker/src/activities/llm-complete.mjs` — the Temporal activity, mirroring `functions-invoke.mjs`: validates tenant context, checks `deps.executeLlmComplete` is wired (throws non-retryable `CAPABILITY_UNAVAILABLE` otherwise), propagates `tenantId`/`workspaceId`, calls `deps.executeLlmComplete({ model, messages, ... })`, returns `{ status: 'success', content, usage, model }`. Disallowed models throw non-retryable `MODEL_NOT_ALLOWED`.
- Register `llmComplete` activity in `services/workflow-worker/src/activities/catalog.mjs` and wire `deps.executeLlmComplete` in `services/workflow-worker/src/worker-deps.mjs` (in-process LLM executor bound to the worker `keyPool` + env `secretResolver`).

## Capabilities

### New Capabilities

None — all new behaviour lives within the existing `workflows` capability.

### Modified Capabilities

- `workflows`: ADD requirements for BYOK LLM provider configuration (workspace-scoped, secretRef-only), LLM completion endpoint (model allow-listing, secret injection, streaming), per-tenant/workspace token-usage metering, first-party `llm.complete` flow activity, and APISIX gateway routes routing LLM subpaths to the executor.

## Impact

- `deploy/kind/apisix/apisix.yaml`: one new route block (`2003-llm`, priority 338) for `^/v1/workspaces/[^/]+/(llm-provider|llm/completions|llm-usage)` → `falcone-cp-executor`.
- `apps/control-plane/src/runtime/`: new module `llm-executor.mjs`; edits to `server.mjs` (5 new routes), `main.mjs` (boot wiring).
- `services/workflow-worker/src/activities/`: new module `llm-complete.mjs`; edits to `catalog-names.mjs` (+1 name), `catalog.mjs` (register activity), `flow-task-types.mjs` is in `apps/` so only the worker side changes here.
- `apps/control-plane/src/runtime/flow-task-types.mjs`: +1 descriptor (`llm.complete`).
- `services/workflow-worker/src/worker-deps.mjs`: wire `deps.executeLlmComplete`.
- Database: two new tables (`workspace_llm_providers`, `workspace_llm_usage`) created lazily via `CREATE TABLE IF NOT EXISTS` at executor boot; no migration file needed (mirrors embedding provider pattern).
- No breaking changes to existing task types or routes.
- `buildTaskTypeCatalog` invariant is maintained: both `TASK_TYPE_NAMES` and `DESCRIPTORS` gain `llm.complete` in the same change.
