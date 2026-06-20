# Tasks — add-llm-agent-flow-task

## 1. Reproduce (test-first — write failing blackbox tests before implementation)

- [x] 1.1 Failing blackbox test `tests/blackbox/llm-provider-store.test.mjs`: drives `createLlmProviderStore` against a recording pool stub — asserts plaintext key stripping, `(tenant_id, workspace_id)` UNIQUE constraint, GET returns secretRef only, cross-tenant isolation (two tenants same workspaceId → each gets only their own row), DELETE returns `{ removed: true }`. Fails before `llm-executor.mjs` exists.
- [x] 1.2 Failing blackbox test `tests/blackbox/llm-usage-store.test.mjs`: drives `createLlmUsageStore` — asserts `recordUsage` inserts a row with all required fields, `getRollup` groups by model and scopes by `(tenant_id, workspace_id)`, cross-tenant isolation (tenant A rollup excludes tenant B rows for same workspaceId). Fails before `llm-executor.mjs` exists.
- [x] 1.3 Failing blackbox test `tests/blackbox/llm-executor-routes.test.mjs`: drives the five executor HTTP routes against in-memory stores — PUT→GET round-trip (no plaintext key in GET), disallowed model → 422 `MODEL_NOT_ALLOWED`, missing provider → 422 `LLM_PROVIDER_MISSING`, secret unresolved → `LLM_PROVIDER_SECRET_UNRESOLVED`, streaming response has SSE content-type and terminal usage event, usage rollup cross-tenant isolation. Fails before server routes exist.
- [x] 1.4 Failing blackbox test `tests/blackbox/llm-complete-activity.test.mjs`: drives `llmComplete` activity — CAPABILITY_UNAVAILABLE when `deps.executeLlmComplete` not wired, MODEL_NOT_ALLOWED is non-retryable, returns `{ status:'success', content, usage, model }` when wired and model allowed. Fails before `llm-complete.mjs` exists.
- [x] 1.5 Failing contract test `tests/contracts/llm-task-type-catalog.contract.test.mjs`: imports `buildTaskTypeCatalog` from `apps/control-plane/src/runtime/flow-task-types.mjs` and `TASK_TYPE_NAMES` from `services/workflow-worker/src/activities/catalog-names.mjs` — asserts `llm.complete` is present in both, `buildTaskTypeCatalog()` does not throw, and the returned descriptor has `category: 'ai'` and an `inputSchema` with required `model`. Fails before catalog changes.

## 2. Implement `llm-executor.mjs`

- [x] 2.1 Create `apps/control-plane/src/runtime/llm-executor.mjs`:
  - `localMockLlmBackend()` — deterministic fixed content + token counts (no external call).
  - `httpLlmBackend({ providerType, endpoint, allowedModels, defaultModel, resolveSecret, fetchImpl })` — OpenAI-compatible `/chat/completions`; per-request secret resolution; `MODEL_NOT_ALLOWED` before provider call; `LLM_PROVIDER_SECRET_UNRESOLVED` when secret is null.
  - `createLlmProviderStore({ pool })` — in-memory fallback when no pool; Postgres path: `workspace_llm_providers` table with `(tenant_id, workspace_id) UNIQUE`, lazy `CREATE TABLE IF NOT EXISTS`, strips `apiKey`/`secret` at write time.
  - `createLlmUsageStore({ pool })` — `workspace_llm_usage` table, lazy `CREATE TABLE IF NOT EXISTS`; `recordUsage` + `getRollup` (SUM by model, scoped to `(tenant_id, workspace_id)`).
  - `createLlmExecutor({ providerStore, usageStore, secretResolver, backendFactory, fetchImpl })` — `setProvider`, `getProvider`, `removeProvider`, `complete` (enforce allow-list → resolve secret → call backend → record usage → return), `getUsage`, `ensureSchema`.
- [x] 2.2 Tests from 1.1, 1.2 green.

## 3. Add server routes (`server.mjs`)

- [x] 3.1 Extend `apps/control-plane/src/runtime/server.mjs` with five routes:
  - `PUT /v1/workspaces/:workspaceId/llm-provider` → `runLlmProvider` (set)
  - `GET /v1/workspaces/:workspaceId/llm-provider` → `runLlmProvider` (get, no plaintext key)
  - `DELETE /v1/workspaces/:workspaceId/llm-provider` → `runLlmProvider` (remove)
  - `POST /v1/workspaces/:workspaceId/llm/completions` → `runLlmComplete` (supports `stream: true`)
  - `GET /v1/workspaces/:workspaceId/llm-usage` → `runLlmUsage`
  Auth: `resolveIdentity` (JWT/API key); `tenantId` injected from verified identity into all store calls.
- [x] 3.2 Tests from 1.3 green.

## 4. Boot wiring (`main.mjs`)

- [x] 4.1 Extend `apps/control-plane/src/runtime/main.mjs`: import `createLlmExecutor` from `./llm-executor.mjs`; create executor bound to metadata `keyPool` with `secretResolver: (secretRef) => secretRef?.name ? process.env[secretRef.name] : null`; call `llmExecutor.ensureSchema()` in the boot retry block.
- [x] 4.2 Pass the executor instance into the server's `runLlmProvider` / `runLlmComplete` / `runLlmUsage` handlers.

## 5. Task-type catalog + flow descriptor

- [x] 5.1 Add `'llm.complete'` to `TASK_TYPE_NAMES` array in `services/workflow-worker/src/activities/catalog-names.mjs`.
- [x] 5.2 Add descriptor `{ id: 'llm.complete', label: 'LLM Complete', category: 'ai', inputSchema: { ... } }` to `DESCRIPTORS` in `apps/control-plane/src/runtime/flow-task-types.mjs`. `inputSchema` required: `['model', 'messages']`; properties: `model` (string), `messages` (array of `{ role, content }`), `prompt` (string, `x-falcone-expression: true`), `system` (string, `x-falcone-expression: true`), `maxTokens` (integer), `temperature` (number); `additionalProperties: false`.
- [x] 5.3 Contract test from 1.5 green; `buildTaskTypeCatalog()` does not throw.

## 6. `llm-complete.mjs` Temporal activity

- [x] 6.1 Create `services/workflow-worker/src/activities/llm-complete.mjs` exporting `llmComplete(input, deps)`:
  - `assertPayloadSize(input, 'input')`.
  - Validate `tenant.tenantId` / `workspaceId` → non-retryable `UNAUTHENTICATED`.
  - Check `typeof deps.executeLlmComplete === 'function'` → non-retryable `CAPABILITY_UNAVAILABLE`.
  - Call `deps.executeLlmComplete({ model, messages, prompt, system, maxTokens, temperature, tenantId, workspaceId })`.
  - `MODEL_NOT_ALLOWED` from executor → re-throw non-retryable.
  - Return `{ status: 'success', content, usage, model }`.
  - `assertPayloadSize(output, 'output', MAX_OUTPUT_BYTES)`.
  Export `llmCompleteInputSchema` and `llmCompleteOutputSchema` (mirrors `functionsInvokeInputSchema` pattern).
- [x] 6.2 Register `llmComplete` in `services/workflow-worker/src/activities/catalog.mjs` (import + `registerActivity('llm.complete', llmComplete)`).
- [x] 6.3 Activity blackbox test from 1.4 green.

## 7. Worker-deps wiring (`worker-deps.mjs`)

- [x] 7.1 Extend `wireActivityDeps` in `services/workflow-worker/src/worker-deps.mjs`: dynamically import `createLlmExecutor` from `apps/control-plane/src/runtime/llm-executor.mjs`; create an in-process `executeLlmComplete` bound to the worker `keyPool` and env `secretResolver`; add it to the returned `deps` object.

## 8. APISIX gateway routes

- [x] 8.1 Add route `2003-llm` to `deploy/kind/apisix/apisix.yaml`:
  ```yaml
  - id: "2003-llm"
    uri: "/v1/workspaces/*"
    priority: 338
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    vars:
      - ["uri", "~~", "^/v1/workspaces/[^/]+/(llm-provider|llm/completions|llm-usage)"]
    plugins:
      cors: {}
      proxy-rewrite:
        headers:
          set:
            x-tenant-id: ""
            x-workspace-id: ""
            x-auth-subject: ""
            x-actor-roles: ""
            x-gateway-auth: "${{GATEWAY_SHARED_SECRET}}"
    upstream:
      type: roundrobin
      scheme: http
      nodes:
        "falcone-cp-executor.falcone.svc.cluster.local:8080": 1
  ```
  Placed adjacent to `2003-embedding` (priority 337), above the generic `2003` catch-all (priority 335).

## 9. Run blackbox, contract, and unit tests

- [x] 9.1 `bash tests/blackbox/run.sh` — all existing tests green + new llm tests pass; 0 regressions.
- [x] 9.2 `node --test tests/contracts/llm-task-type-catalog.contract.test.mjs` — passes.
- [x] 9.3 `node --check` on all new/edited `.mjs` modules in `apps/control-plane/src/runtime/` and `services/workflow-worker/src/`.
- [x] 9.4 `buildTaskTypeCatalog()` smoke: `node -e "import('./apps/control-plane/src/runtime/flow-task-types.mjs').then(m => { m.buildTaskTypeCatalog(); console.log('ok'); })"` — prints `ok`, no throw.

## 10. Gateway route-catalog parity

Decision (mirrors the embedding-provider precedent): the executor-served BYOK routes are NOT in the
GENERATED `services/internal-contracts/src/public-route-catalog.json` (which has no embedding-provider
entry either). They ARE classified in the hand-curated gateway allow-list
`services/gateway-config/public-route-catalog.json`, exactly where embedding-provider's PUT/DELETE
live. The runtime gateway routing for kind is the dedicated APISIX route added in section 8.

- [x] 10.1 Add the LLM routes to `services/gateway-config/public-route-catalog.json`: provider PUT/DELETE → `structural_admin`; `POST .../llm/completions` and `GET .../llm-usage` → `data_access` (matches the embedding-provider classification + the catalog-reading contract tests stay green).

## 11. Live verification on kind (provider + completion + usage plane; no Temporal required)

- [ ] 11.1 Rebuild and push `falcone-cp-executor` image to `localhost:30500`; roll the deployment on `test-cluster-b`.
- [ ] 11.2 Through the gateway with a real `tenant_owner` principal (acme-ops): `PUT /v1/workspaces/{ws}/llm-provider` with `localMock` backend → 200; `GET` → secretRef present, no key; `POST /v1/workspaces/{ws}/llm/completions` with allowed model → 200 `{ content, usage, model }`; `GET /v1/workspaces/{ws}/llm-usage` → rollup by model; `DELETE` → `{ removed: true }`; subsequent GET → 404 `LLM_PROVIDER_NOT_FOUND`.
- [ ] 11.3 Cross-tenant probe: globex-ops `GET /v1/workspaces/{acme-ws}/llm-provider` → 404 or empty (not acme's config).
- [ ] 11.4 Revert executor deployment to prior image after verification.

## 12. Archive

- [x] 12.1 `openspec validate add-llm-agent-flow-task --strict` — clean.
- [ ] 12.2 `/opsx:archive add-llm-agent-flow-task` after merge.
