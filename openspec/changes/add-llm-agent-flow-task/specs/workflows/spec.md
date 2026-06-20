## ADDED Requirements

### Requirement: BYOK LLM provider configuration is workspace-scoped and stores only a secret reference

The system SHALL provide a per-workspace BYOK LLM provider configuration managed via `PUT/GET/DELETE /v1/workspaces/{workspaceId}/llm-provider`, persisting `providerType`, `endpoint`, an `allowedModels` list, an optional `defaultModel`, and a `secretRef` — NEVER a plaintext API key. Configuration SHALL be tenant-scoped by `(tenant_id, workspace_id)` in the `workspace_llm_providers` table. GET SHALL return the configuration without any plaintext secret (only the `secretRef`).

#### Scenario: Set then get round-trip
- **WHEN** a tenant sends `PUT /v1/workspaces/{workspaceId}/llm-provider` with `{ providerType, endpoint, allowedModels, secretRef }` and then `GET /v1/workspaces/{workspaceId}/llm-provider`
- **THEN** the GET response SHALL contain `providerType`, `endpoint`, `allowedModels`, and `secretRef` and SHALL NOT contain any plaintext API key or resolved secret value

#### Scenario: Plaintext key is never persisted
- **WHEN** a caller sends `PUT /v1/workspaces/{workspaceId}/llm-provider` with an `apiKey` or `secret` field in the request body
- **THEN** the system SHALL strip those fields before persisting and SHALL store only the `secretRef`; a subsequent GET SHALL return no `apiKey` or `secret` field

#### Scenario: Cross-tenant isolation
- **WHEN** tenant A and tenant B each configure an LLM provider under the same `workspaceId` value
- **THEN** `GET /v1/workspaces/{workspaceId}/llm-provider` for tenant A SHALL return only tenant A's configuration and SHALL NOT include any data from tenant B's row

#### Scenario: Delete removes the provider
- **WHEN** a tenant sends `DELETE /v1/workspaces/{workspaceId}/llm-provider`
- **THEN** the system SHALL return `{ removed: true }` and a subsequent `GET /v1/workspaces/{workspaceId}/llm-provider` SHALL return HTTP 404 with error code `LLM_PROVIDER_NOT_FOUND`

---

### Requirement: LLM completion enforces the model allow-list and injects the BYOK key

The system SHALL provide `POST /v1/workspaces/{workspaceId}/llm/completions` that resolves the workspace BYOK provider, REJECTS any `model` not in the configured `allowedModels` with HTTP 422 `MODEL_NOT_ALLOWED` before any provider call, resolves the `secretRef` to a key at request time (no caching), calls the configured OpenAI-compatible `/chat/completions` endpoint with `Authorization: Bearer <key>`, and returns `{ content, usage, model }`. A missing provider SHALL return HTTP 422 `LLM_PROVIDER_MISSING`; an unresolvable secret SHALL fail closed with error code `LLM_PROVIDER_SECRET_UNRESOLVED` (the system SHALL NOT make an unauthenticated provider call).

#### Scenario: Allowed model succeeds
- **WHEN** a tenant sends `POST /v1/workspaces/{workspaceId}/llm/completions` with a `model` present in the workspace `allowedModels` list and the provider secret resolves successfully
- **THEN** the system SHALL call the configured provider endpoint with `Authorization: Bearer <resolved-key>` and SHALL return HTTP 200 with `{ content, usage, model }`

#### Scenario: Disallowed model rejected
- **WHEN** a tenant sends `POST /v1/workspaces/{workspaceId}/llm/completions` with a `model` NOT present in the workspace `allowedModels` list
- **THEN** the system SHALL return HTTP 422 with error code `MODEL_NOT_ALLOWED` and SHALL NOT make any outbound call to the provider endpoint

#### Scenario: No provider configured
- **WHEN** a tenant sends `POST /v1/workspaces/{workspaceId}/llm/completions` and no BYOK provider has been configured for that workspace
- **THEN** the system SHALL return HTTP 422 with error code `LLM_PROVIDER_MISSING`

#### Scenario: Secret unresolved fails closed
- **WHEN** a tenant sends `POST /v1/workspaces/{workspaceId}/llm/completions`, a BYOK provider is configured, and the `secretRef` resolves to `null` (e.g. the ESO/Vault-mounted env var is absent)
- **THEN** the system SHALL return an error with code `LLM_PROVIDER_SECRET_UNRESOLVED` and SHALL NOT make any outbound call to the provider endpoint

---

### Requirement: LLM completions stream incrementally when requested

The system SHALL support `stream: true` in the `POST /v1/workspaces/{workspaceId}/llm/completions` request body, proxying the provider's incremental tokens to the caller as a Server-Sent Events stream and emitting a final event containing cumulative token usage. Token usage SHALL still be metered and persisted in `workspace_llm_usage` for streamed completions.

#### Scenario: Streaming returns incremental chunks then a terminal usage event
- **WHEN** a tenant sends `POST /v1/workspaces/{workspaceId}/llm/completions` with `stream: true` and the provider supports SSE streaming
- **THEN** the system SHALL respond with `Content-Type: text/event-stream`, proxy incremental content tokens as `data:` events, and emit a terminal `data:` event containing `{ usage: { promptTokens, completionTokens, totalTokens } }` before closing the stream

#### Scenario: Non-streaming returns a single JSON body with content and usage
- **WHEN** a tenant sends `POST /v1/workspaces/{workspaceId}/llm/completions` without `stream: true` (or with `stream: false`)
- **THEN** the system SHALL respond with `Content-Type: application/json` and a single body `{ content, usage: { promptTokens, completionTokens, totalTokens }, model }`

---

### Requirement: Per-tenant/workspace LLM token usage is metered

The system SHALL record `promptTokens`, `completionTokens`, `totalTokens`, and `model` for every LLM completion (both streaming and non-streaming) in the `workspace_llm_usage` table, tenant-scoped by `(tenant_id, workspace_id)`. The system SHALL expose a rollup via `GET /v1/workspaces/{workspaceId}/llm-usage`. Usage SHALL be scoped by `(tenant_id, workspace_id)` and SHALL NEVER aggregate rows across tenants.

#### Scenario: Usage recorded after completion
- **WHEN** a tenant successfully completes a `POST /v1/workspaces/{workspaceId}/llm/completions` request
- **THEN** the system SHALL append a row to `workspace_llm_usage` with non-null `promptTokens`, `completionTokens`, `totalTokens`, `model`, `tenantId`, and `workspaceId`

#### Scenario: Rollup is per-model and tenant-scoped
- **WHEN** a tenant sends `GET /v1/workspaces/{workspaceId}/llm-usage`
- **THEN** the system SHALL return totals grouped by `model` for the calling tenant only, with each group containing `model`, `promptTokens`, `completionTokens`, and `totalTokens` summed across all completions for that model in that workspace

#### Scenario: Cross-tenant isolation in usage rollup
- **WHEN** tenant A and tenant B both complete LLM requests under the same `workspaceId` value, and tenant A calls `GET /v1/workspaces/{workspaceId}/llm-usage`
- **THEN** the response SHALL include only tenant A's usage rows and SHALL NOT include any token counts from tenant B's completions

---

### Requirement: llm.complete first-party flow activity

The system SHALL register a first-party `llm.complete` task type in `TASK_TYPE_NAMES` (`services/workflow-worker/src/activities/catalog-names.mjs`), in the `DESCRIPTORS` array (`apps/control-plane/src/runtime/flow-task-types.mjs`), and in the Temporal activity catalog (`services/workflow-worker/src/activities/catalog.mjs`), so that `buildTaskTypeCatalog`'s id-set invariant holds and `GET /v1/flows/workspaces/{workspaceId}/task-types` lists `llm.complete` in its response. The `llm.complete` Temporal activity SHALL execute under the tenant-scoped execution credential, propagate `tenantId` and `workspaceId` from the execution context, enforce the model allow-list (rejecting disallowed models with a non-retryable `ApplicationFailure` bearing error code `MODEL_NOT_ALLOWED`), meter usage, and return `{ status: 'success', content, usage, model }`. When `deps.executeLlmComplete` is not wired the activity SHALL throw a non-retryable `ApplicationFailure` with error code `CAPABILITY_UNAVAILABLE` and SHALL NOT silently succeed. The descriptor `inputSchema` SHALL accept `model` (required string), `messages` (array of `{ role, content }` objects), and optional `prompt` (string), `system` (string), `maxTokens` (integer), and `temperature` (number); string fields carrying CEL/expression values SHALL be marked `x-falcone-expression: true`.

#### Scenario: Task-types catalog includes llm.complete
- **WHEN** a tenant calls `GET /v1/flows/workspaces/{workspaceId}/task-types`
- **THEN** the response SHALL include an entry with `id: 'llm.complete'` and `buildTaskTypeCatalog()` SHALL complete without throwing

#### Scenario: Flow referencing llm.complete validates
- **WHEN** a flow definition containing a task node with `taskType: 'llm.complete'` is submitted to `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/validate`
- **THEN** the validator SHALL accept the task type (FLW-E006 SHALL NOT fire for `llm.complete`) and SHALL return HTTP 200 `{ valid: true }` for an otherwise well-formed definition

#### Scenario: Activity returns content and usage
- **WHEN** a dispatched `llm.complete` activity is invoked with valid `tenant`, `params.model`, and `params.messages` and `deps.executeLlmComplete` is wired
- **THEN** the activity SHALL return `{ status: 'success', content, usage: { promptTokens, completionTokens, totalTokens }, model }`

#### Scenario: Disallowed model is non-retryable
- **WHEN** a `llm.complete` activity is invoked with a `model` not in the workspace `allowedModels`
- **THEN** the activity SHALL throw a non-retryable Temporal `ApplicationFailure` with error code `MODEL_NOT_ALLOWED` and SHALL NOT invoke the LLM provider

#### Scenario: Executor unavailable is non-retryable
- **WHEN** a `llm.complete` activity is invoked and `deps.executeLlmComplete` is not wired (undefined or not a function)
- **THEN** the activity SHALL throw a non-retryable Temporal `ApplicationFailure` with error code `CAPABILITY_UNAVAILABLE`

---

### Requirement: BYOK LLM gateway routes target the executor

The system SHALL register APISIX route(s) matching `^/v1/workspaces/[^/]+/(llm-provider|llm/completions|llm-usage)` at a priority higher than both the generic `/v1/workspaces/*` route (`2003`, priority 335) and the embedding-provider route (`2003-embedding`, priority 337), routing them to `falcone-cp-executor`, stripping client-supplied identity headers (`x-tenant-id`, `x-workspace-id`, `x-auth-subject`, `x-actor-roles`) and injecting `x-gateway-auth: ${{GATEWAY_SHARED_SECRET}}`, so that LLM subpath requests are served by the executor rather than falling through to the control-plane and returning 404 `NO_ROUTE`.

#### Scenario: llm-provider reaches the executor
- **WHEN** a gateway request targets `/v1/workspaces/{workspaceId}/llm-provider` (any of PUT, GET, DELETE)
- **THEN** the APISIX gateway SHALL route the request to `falcone-cp-executor` (not `falcone-control-plane`) and the executor SHALL serve the response
