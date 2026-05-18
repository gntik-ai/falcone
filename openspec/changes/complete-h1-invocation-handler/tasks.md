## 1. Failing tests

- [ ] 1.1 [test] Add `tests/e2e/functions/functions-invoke.test.mjs` that
      drives `POST /v1/functions/{id}/invoke` through the gateway and
      asserts a 200 with a real-looking activation id (not
      `act_*_pending`); proves B3 against the OpenAPI fragment at
      `apps/control-plane/openapi/families/functions.openapi.json`.
- [ ] 1.2 [test] Add `tests/adapters/openwhisk-admin-dispatch.test.mjs`
      that invokes `dispatchWorkflowAction` against a mocked
      `OpenWhiskClient` and asserts (a) input validation rejects empty
      namespace/actionRef, (b) the returned activation id is the client's,
      (c) failure cases surface a structured `{status: 'failed', errorCode}`
      record (proves B4 at
      `services/adapters/src/openwhisk-admin.mjs:1792-1812`).
- [ ] 1.3 [test] Add a case asserting the handler honours
      `OPENWHISK_INVOCATION_DISABLED=true` by returning
      `503 INVOCATION_DISABLED`.

## 2. Implementation

- [ ] 2.1 [impl] Add `apps/control-plane/src/functions-invoke.mjs` exposing
      a `createFunctionsInvokeHandler({ openWhiskClient, publishAuditEvent
      })` factory; the handler consumes
      `buildOpenWhiskAdminAdapterCall` and dispatches through the client.
- [ ] 2.2 [fix] Rewrite `dispatchWorkflowAction` at
      `openwhisk-admin.mjs:1792-1812` to validate `namespace`, `actionRef`,
      and `payload`, then delegate to the injected client and return the
      real activation envelope (or a structured failure).
- [ ] 2.3 [impl] Implement synchronous and asynchronous response modes per
      design.md; asynchronous returns `{activationId, statusPollUrl}` and
      the handler does not block.
- [ ] 2.4 [impl] Wire activation-id propagation through the audit envelope
      so the published event records the real provider id.
- [ ] 2.5 [impl] Register `OPENWHISK_INVOCATION_DISABLED` as a deployment
      feature flag; surface `503 INVOCATION_DISABLED` when set.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/functions-runtime/spec.md`
      covering the handler contract, dispatcher validation, and sync vs
      async semantics.
- [ ] 3.2 [docs] Document the new handler and the OpenWhisk client
      interface in the `functions-admin` README; cross-reference the
      gateway-config upstream wiring.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- 'functions-invoke|openwhisk-admin'`
      and `openspec validate complete-h1-invocation-handler --strict`;
      both green before merge.
