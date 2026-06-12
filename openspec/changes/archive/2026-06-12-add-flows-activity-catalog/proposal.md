## Why

Flow execution tasks must call Falcone's own platform services (data API, storage, functions, events, outbound HTTP) under the executing tenant's identity, never using static platform-level credentials. There is currently no activity layer in `services/workflow-worker/` that wraps these first-party invocations, so the workflow engine (epic #355) has no way to trigger them with proper tenant scoping.

## What Changes

- Introduce a NEW `workflows` capability owning the task-type activity catalog and its registry within `services/workflow-worker/`.
- Implement six first-party activity task types, each invoking the platform through its existing executor surface with a tenant-scoped short-lived `flc_service_…` API key minted per-execution:
  - `db.query` — Postgres/Mongo data API via `postgres-data-executor.mjs` / `mongo-data-executor.mjs`, respecting RLS and the `falcone_service` db role (`apps/control-plane/src/runtime/api-keys.mjs::ROLE_BY_TYPE`).
  - `storage.put` / `storage.get` — storage object API (`PUT /v1/storage/buckets/{resourceId}/objects/{objectKey}` / `GET …/download` per public-route-catalog `uploadStorageObject` / `downloadStorageObject`).
  - `functions.invoke` — functions invoke API (`POST /v1/functions/actions/{resourceId}/invocations` per public-route-catalog `invokeFunctionAction`; backed by `apps/control-plane/src/runtime/functions-executor.mjs::executeFunctions`).
  - `events.publish` — Kafka events publish (`events-executor.mjs::physicalTopic` workspace-prefix isolation).
  - `http.request` — outbound HTTP with SSRF guard parity (`services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` + DNS-rebinding re-check at delivery time; `webhook-engine/actions/webhook-delivery-worker.mjs` pattern); timeout and response-size caps enforced.
  - `email.send` — explicitly deferred: no platform SMTP capability exists in `services/` or `apps/` (confirmed absent). The task type is registered as a stub that returns `CAPABILITY_UNAVAILABLE` unless platform SMTP config is present. Rationale recorded in the issue and here.
- Introduce a **task-type registry** (`name → { activity, inputSchema, outputSchema }`): the canonical extension point for future task types; feeds DSL validation (#358) and the console palette (#363).
- Classify activity failures as **retryable** or **non-retryable** per task type (network/transient errors retryable; auth/schema/quota errors non-retryable) and expose the classification to the Temporal retry policy.
- Enforce **payload size limits** on all activity inputs and outputs (hard cap matching Temporal blob limits; oversized payloads fail with `PAYLOAD_TOO_LARGE` before any platform call is made).
- A real-stack test in `tests/env/` proves `db.query` from tenant A cannot read tenant B rows through the activity path (RLS enforced end-to-end).
- A black-box test mirroring `tests/blackbox/webhook-ssrf-guard.test.mjs` covers `http.request` SSRF blocking.

## Capabilities

### New Capabilities
- `workflows`: Temporal-based workflow engine capability, introduced by this change scoped to the first-party task-type activity catalog. Sibling changes (`add-flows-dsl-interpreter-worker`, `add-flows-tenancy-isolation-limits`, `add-flows-dsl-schema`) own the interpreter/worker shell, credential minting details, and DSL schema respectively.

### Modified Capabilities

(none — all requirements are new)

## Impact

- **New service module**: `services/workflow-worker/src/activities/` (one file per task type + `registry.mjs`).
- **Depends on**: `apps/control-plane/src/runtime/api-keys.mjs` (key minting — `issueKey`), `postgres-data-executor.mjs`, `mongo-data-executor.mjs`, `events-executor.mjs`, `functions-executor.mjs`, `services/webhook-engine/src/webhook-subscription.mjs` (`isBlockedIp`).
- **Feeds**: #358 (DSL validation rejects unknown `taskType` values not in registry), #363 (console palette reads registry for task-type list).
- **Co-design**: credential minting/enforcement runtime details deferred to `add-flows-tenancy-isolation-limits` (#362).
- **GitHub issue**: #360, child of epic #355.
</content>
</invoke>