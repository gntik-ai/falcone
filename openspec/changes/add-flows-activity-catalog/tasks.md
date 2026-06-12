## 1. Foundation

- [ ] 1.1 Create `services/workflow-worker/src/activities/` directory and `limits.mjs` (payload size constants: `MAX_INPUT_BYTES = 2 * 1024 * 1024`, `MAX_OUTPUT_BYTES = 2 * 1024 * 1024`)
- [ ] 1.2 Implement `assertPayloadSize(value, label)` in `limits.mjs`; throws non-retryable `ApplicationFailure` with code `PAYLOAD_TOO_LARGE` when serialized JSON exceeds limit
- [ ] 1.3 Implement `toNonRetryable(code, message)` and `toRetryable(code, message)` helpers in `services/workflow-worker/src/activities/errors.mjs` wrapping Temporal `ApplicationFailure`
- [ ] 1.4 Create `services/workflow-worker/src/activities/registry.mjs` with a `Map<string, { activity, inputSchema, outputSchema }>` and `registerActivity` / `resolveActivity` exports

## 2. SSRF guard reuse

- [ ] 2.1 Confirm `services/webhook-engine/src/webhook-subscription.mjs::isBlockedIp` is importable from the worker package; add the import path to `services/workflow-worker/package.json` workspace reference if needed
- [ ] 2.2 Implement `resolveSsrfSafe(url)` in `services/workflow-worker/src/activities/ssrf.mjs`: static blocklist check + DNS resolution + delivery-time re-check; mirrors `webhook-delivery-worker.mjs` `resolveTarget` pattern; throws non-retryable `SSRF_BLOCKED` on any block

## 3. db.query activity

- [ ] 3.1 Implement `services/workflow-worker/src/activities/db-query.mjs` activity: accepts `{ engine, databaseName, schemaName?, collectionName?, tableName?, operation, filter?, values?, ... }` + injected `{ tenantId, workspaceId, credential }` context; delegates to `executePostgresData` or `executeMongoData` with `identity.dbRole = "falcone_service"`
- [ ] 3.2 Apply `assertPayloadSize` on input and output
- [ ] 3.3 Map executor errors to retryable/non-retryable per D6 table
- [ ] 3.4 Register `db.query` in the task-type registry with input/output JSON Schemas

## 4. storage.put activity

- [ ] 4.1 Implement `services/workflow-worker/src/activities/storage-put.mjs`: invokes `uploadStorageObject` path; enforces workspace ownership via tenant-scoped credential
- [ ] 4.2 Apply `assertPayloadSize` on input
- [ ] 4.3 Map 403 → non-retryable `FORBIDDEN`; network errors → retryable
- [ ] 4.4 Register `storage.put` in the task-type registry with input/output JSON Schemas

## 5. storage.get activity

- [ ] 5.1 Implement `services/workflow-worker/src/activities/storage-get.mjs`: invokes `downloadStorageObject` path; returns body base64-encoded
- [ ] 5.2 Apply `assertPayloadSize` on output
- [ ] 5.3 Map 404 → non-retryable `OBJECT_NOT_FOUND`; network errors → retryable
- [ ] 5.4 Register `storage.get` in the task-type registry with input/output JSON Schemas

## 6. functions.invoke activity

- [ ] 6.1 Implement `services/workflow-worker/src/activities/functions-invoke.mjs`: calls `invokeFunctionAction` route via executor or HTTP; carries tenant-scoped credential
- [ ] 6.2 Apply `assertPayloadSize` on input and output
- [ ] 6.3 Map `FUNCTION_NOT_FOUND` → non-retryable; timeout → retryable
- [ ] 6.4 Register `functions.invoke` in the task-type registry with input/output JSON Schemas

## 7. events.publish activity

- [ ] 7.1 Implement `services/workflow-worker/src/activities/events-publish.mjs`: calls `executeFunctions` (operation `publish`) via events-executor; enforces `evt.<workspaceId>.<topic>` prefix
- [ ] 7.2 Apply `assertPayloadSize` on input
- [ ] 7.3 Map empty-messages → non-retryable `EMPTY_PUBLISH`; Kafka broker errors → retryable
- [ ] 7.4 Register `events.publish` in the task-type registry with input/output JSON Schemas

## 8. http.request activity

- [ ] 8.1 Implement `services/workflow-worker/src/activities/http-request.mjs`: calls `resolveSsrfSafe` before every request; enforces timeout (default 10 s, max 30 s) and response-body size cap (default 1 MiB, max 10 MiB); does NOT forward tenant credentials to target
- [ ] 8.2 Apply `assertPayloadSize` on input and output
- [ ] 8.3 Map SSRF block → non-retryable `SSRF_BLOCKED`; timeout → retryable `REQUEST_TIMEOUT`; body oversize → non-retryable `RESPONSE_TOO_LARGE`
- [ ] 8.4 Register `http.request` in the task-type registry with input/output JSON Schemas

## 9. email.send stub

- [ ] 9.1 Implement `services/workflow-worker/src/activities/email-send.mjs` as a stub that always throws non-retryable `CAPABILITY_UNAVAILABLE` with message `"email.send is not available: no platform SMTP configuration"`
- [ ] 9.2 Register `email.send` in the task-type registry with placeholder input/output JSON Schemas

## 10. Tests

- [ ] 10.1 Write `tests/blackbox/flows-activity-ssrf.test.mjs` mirroring `tests/blackbox/webhook-ssrf-guard.test.mjs`: covers `http.request` SSRF scenarios (link-local, decimal-encoded IP, DNS-rebinding); use non-provider-shaped test fixtures (no `sk_live_` etc.)
- [ ] 10.2 Write `tests/env/flows-db-query-rls.test.mjs` (real-stack, requires pgvector image gate from `pgvector-test-env-image-gap` memory): proves tenant A `db.query` activity cannot read tenant B rows through the RLS path
- [ ] 10.3 Write unit tests for `assertPayloadSize`, `toNonRetryable`, `toRetryable`, and registry `resolveActivity` (unknown key → `UNKNOWN_TASK_TYPE`)
- [ ] 10.4 Confirm `tests/blackbox/run.sh` picks up new blackbox tests and passes

## 11. Registry wire-up

- [ ] 11.1 Export registry from `services/workflow-worker/src/activities/index.mjs` for consumption by #358 (DSL validation) and #363 (console palette)
- [ ] 11.2 Document the registry shape in a code comment (not a doc file) so sibling changes (#358, #363) know the contract
</content>
</invoke>