## 0. Implementation notes / deviations (recorded during apply)

- **Module format**: tasks below say `*.mjs`. The `workflow-worker` package is TypeScript +
  CommonJS by a hard Temporal SDK constraint (its `package.json` deliberately omits
  `"type":"module"`). The activity catalog is therefore authored as native-ESM `.mjs`
  modules under `services/workflow-worker/src/activities/` (so the `node --test` unit +
  black-box suites import the PUBLIC surface with no build step, and each activity can
  `import { ApplicationFailure }` from the CommonJS `@temporalio/activity` via Node's
  ESM↔CJS interop). The TypeScript `index.ts` `executeTask` seam bridges to the catalog at
  runtime via a genuine dynamic ESM `import()` (a `new Function('return import(s)')`
  indirection so tsc does not downlevel it into `require()`). A build step
  (`scripts/copy-activity-catalog.mjs`) copies the `.mjs` modules into `dist/` next to the
  compiled CJS so the Temporal harness's `require('dist/activities/index.js')` works.
- **Dispatch vs. authoritative registry**: the registry is authoritative for DSL validation
  (FLW-E006) and the public `resolveActivity` fails closed with `UNKNOWN_TASK_TYPE`. At
  DISPATCH time, an UNREGISTERED taskType that reaches the worker falls back to the
  interpreter's echo seam rather than failing the run — the upstream interpreter harness
  (`add-flows-dsl-interpreter-worker`) drives graph-walk fixtures with placeholder task
  types (`fetch-record`, `noop-a`, …) that are not first-party catalog entries. Production
  definitions cannot reach the worker with an unknown type: FLW-E006 rejects them first
  (verified: validate returns HTTP 422 / FLW-E006).
- **FLW-E006 vs. UNKNOWN_TASK_TYPE**: the control-plane validate endpoint rejects an unknown
  taskType with HTTP 422 and error code `FLW-E006` (the shared validator's existing code),
  surfaced inside `FLOW_VALIDATION_FAILED.errors[]`. The registry's own `resolveActivity`
  throws `UNKNOWN_TASK_TYPE`. The spec scenario is updated to reflect both truthfully.
- **Storage executor**: storage has no importable executor module in the control-plane
  runtime (it is served over the HTTP API / proxied), so `storage.put` / `storage.get` call
  the platform over an injected HTTP client (the `uploadStorageObject` / `downloadStorageObject`
  routes) rather than via a direct executor import (D1 applies to db/events/functions).
- **Wiring point**: the validate/publish endpoints already accepted an injectable
  `taskTypeCatalog` (upstream `add-flows-control-plane-api`); this change feeds it the real
  catalog via `apps/control-plane/src/runtime/main.mjs` importing the Temporal-FREE
  `catalog-names.mjs` (`TASK_TYPE_NAMES`), so the control-plane never loads `@temporalio/*`.

## 1. Foundation

- [x] 1.1 Create `services/workflow-worker/src/activities/` directory and `limits.mjs` (payload size constants: `MAX_INPUT_BYTES = 2 * 1024 * 1024`, `MAX_OUTPUT_BYTES = 2 * 1024 * 1024`)
- [x] 1.2 Implement `assertPayloadSize(value, label)` in `limits.mjs`; throws non-retryable `ApplicationFailure` with code `PAYLOAD_TOO_LARGE` when serialized JSON exceeds limit
- [x] 1.3 Implement `toNonRetryable(code, message)` and `toRetryable(code, message)` helpers in `services/workflow-worker/src/activities/errors.mjs` wrapping Temporal `ApplicationFailure`
- [x] 1.4 Create `services/workflow-worker/src/activities/registry.mjs` with a `Map<string, { activity, inputSchema, outputSchema }>` and `registerActivity` / `resolveActivity` exports

## 2. SSRF guard reuse

- [x] 2.1 Confirm `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` is importable from the worker package (imported via relative path; no package.json change needed — the path is stable across `src/` and `dist/`)
- [x] 2.2 Implement `resolveSsrfSafe(url)` in `services/workflow-worker/src/activities/ssrf.mjs`: static blocklist check (incl. numeric/decimal IPv4) + DNS resolution + delivery-time re-check + IP pinning; mirrors `webhook-delivery-worker.mjs` `resolveDeliveryTarget`; throws non-retryable `SSRF_BLOCKED` on any block

## 3. db.query activity

- [x] 3.1 Implement `db-query.mjs`: accepts the data-API envelope + injected `{ tenantId, workspaceId, credential }`; delegates to `executePostgresData` / `executeMongoData` with `identity.dbRole = "falcone_service"`
- [x] 3.2 Apply `assertPayloadSize` on input and output
- [x] 3.3 Map executor errors to retryable/non-retryable per D6 (UNDEFINED_TABLE/PLAN_REJECTED → SCHEMA_ERROR non-retryable; timeouts/503/429 → retryable)
- [x] 3.4 Register `db.query` in the registry with input/output JSON Schemas

## 4. storage.put activity

- [x] 4.1 Implement `storage-put.mjs`: invokes the `uploadStorageObject` route over the injected HTTP client; tenant-scoped credential authenticates the upload
- [x] 4.2 Apply `assertPayloadSize` on input
- [x] 4.3 Map 403 → non-retryable `FORBIDDEN`; network errors → retryable
- [x] 4.4 Register `storage.put` in the registry with input/output JSON Schemas

## 5. storage.get activity

- [x] 5.1 Implement `storage-get.mjs`: invokes `downloadStorageObject`; returns body base64-encoded
- [x] 5.2 Apply `assertPayloadSize` on output
- [x] 5.3 Map 404 → non-retryable `OBJECT_NOT_FOUND`; network errors → retryable
- [x] 5.4 Register `storage.get` in the registry with input/output JSON Schemas

## 6. functions.invoke activity

- [x] 6.1 Implement `functions-invoke.mjs`: calls `executeFunctions` (operation `invoke`); carries tenant-scoped credential + workspace
- [x] 6.2 Apply `assertPayloadSize` on input and output
- [x] 6.3 Map `FUNCTION_NOT_FOUND` (404) → non-retryable; executor `timeout` status → retryable `FUNCTION_TIMEOUT`
- [x] 6.4 Register `functions.invoke` in the registry with input/output JSON Schemas

## 7. events.publish activity

- [x] 7.1 Implement `events-publish.mjs`: calls `executeEvents` (operation `publish`); the executor enforces the `evt.<workspaceId>.<topic>` prefix
- [x] 7.2 Apply `assertPayloadSize` on input
- [x] 7.3 Map empty-messages → non-retryable `EMPTY_PUBLISH` (before any Kafka call); Kafka broker errors (502 KAFKA_ERROR) → retryable `BROKER_UNAVAILABLE`
- [x] 7.4 Register `events.publish` in the registry with input/output JSON Schemas

## 8. http.request activity

- [x] 8.1 Implement `http-request.mjs`: `resolveSsrfSafe` before every request; timeout (default 10 s, max 30 s); response-body cap (default 1 MiB, max 10 MiB); does NOT forward tenant credentials/internal headers; redirect:manual
- [x] 8.2 Apply `assertPayloadSize` on input and output
- [x] 8.3 Map SSRF block → non-retryable `SSRF_BLOCKED`; timeout → retryable `REQUEST_TIMEOUT`; body oversize → non-retryable `RESPONSE_TOO_LARGE`
- [x] 8.4 Register `http.request` in the registry with input/output JSON Schemas

## 9. email.send stub

- [x] 9.1 Implement `email-send.mjs` as a stub that always throws non-retryable `CAPABILITY_UNAVAILABLE` with message `"email.send is not available: no platform SMTP configuration"`
- [x] 9.2 Register `email.send` in the registry with placeholder input/output JSON Schemas

## 10. Tests

- [x] 10.1 Write `tests/blackbox/flows-activity-ssrf.test.mjs` mirroring `tests/blackbox/webhook-ssrf-guard.test.mjs` (link-local, decimal-encoded IP, DNS-rebinding, fail-closed, non-http scheme, no-credential-forwarding, IP pinning). Non-provider-shaped fixtures only. Also added `tests/blackbox/flows-activities.test.mjs` (registry/schemas/classification public surface).
- [x] 10.2 Write `tests/env/flows-db-query-rls.test.mjs` (real-stack): tenant A `db.query` activity cannot read tenant B rows through the RLS path (run under non-BYPASSRLS `falcone_service`). Also added real-stack `tests/env/flows-events-publish.test.mjs` (workspace topic) + `tests/env/flows-http-ssrf.test.mjs` (live SSRF block).
- [x] 10.3 Write unit tests for `assertPayloadSize`, `toNonRetryable`, `toRetryable`, registry `resolveActivity` (unknown → `UNKNOWN_TASK_TYPE`), and per-activity error classification/size caps (`tests/unit/flows-activity-limits.test.mjs`, `tests/unit/flows-activity-catalog.test.mjs`)
- [x] 10.4 Confirm `tests/blackbox/run.sh` picks up new black-box tests and passes (455 pass / 0 fail)

## 11. Registry wire-up

- [x] 11.1 Export the registry from `services/workflow-worker/src/activities/index.mjs` (`taskTypeNames`, `listTaskTypes`, `resolveActivity`, `dispatchTask`, per-activity exports) for #358 (DSL validation) and #363 (console palette); wire the Temporal-free `TASK_TYPE_NAMES` into the control-plane validate/publish endpoints (`main.mjs::createFlowExecutor({ taskTypeCatalog })`)
- [x] 11.2 Document the registry shape in a code comment (registry.mjs "REGISTRY ENTRY SHAPE") so #358/#363 know the contract
