## Why

The `POST /v1/functions/{id}/invoke` route is declared in the OpenAPI fragment
but has no handler in source, and the helper closest to dispatching returns a
synthetic activation envelope without ever talking to OpenWhisk. From
`openspec/audit/cap-h1-openwhisk-function-admin-invocation.md`:

- **B3** (route `POST /v1/functions/{id}/invoke` in
  `apps/control-plane/openapi/families/functions.openapi.json`) — `grep -rln
  "POST /v1/functions"` returns only route declarations, the gateway-config
  route table, the OpenAPI fragments, migration files, the authorization
  model, a web-console test fixture, and
  `apps/control-plane/src/console-backend-functions.mjs` (which calls saga
  workflows, not OpenWhisk). No file consumes `buildOpenWhiskAdminAdapterCall`
  to actually invoke an OpenWhisk action.
- **B4** (`services/adapters/src/openwhisk-admin.mjs:1792-1812`) —
  `dispatchWorkflowAction(namespace, actionRef, payload, annotation)` does
  not validate inputs and unconditionally returns `{activationId:
  \`act_${slug}_${idemSlice12 || 'pending'}\`, namespace, actionRef, ...}`.
  Callers treating the result as a real OpenWhisk activation id receive a
  fabricated id bound to no real invocation.
- **G1** (no runtime that calls OpenWhisk lives in this repo).
- **G23** (no test exercises `dispatchWorkflowAction`).

## What Changes

- Stand up `apps/control-plane/src/functions-invoke.mjs` that implements
  the `POST /v1/functions/{id}/invoke` handler, consuming the adapter's
  compiled call envelope (`buildOpenWhiskAdminAdapterCall`) and dispatching
  to an OpenWhisk client behind an injected `OpenWhiskClient` interface.
- Replace `dispatchWorkflowAction` with a thin wrapper that validates
  inputs, calls the OpenWhisk client, and returns the provider's real
  activation id (or a structured failure record).
- Define synchronous (`responseMode: 'synchronous'`) and asynchronous
  (`responseMode: 'asynchronous'`) semantics — synchronous returns the
  activation result; asynchronous returns the activation id and a
  status-poll URL.
- Wire activation-id propagation into the audit envelope so audits link to
  the real provider activation.
- Add a feature flag (`OPENWHISK_INVOCATION_DISABLED=true`) so deployments
  without an OpenWhisk runtime fail closed with a stable error rather than
  the current synthetic activation.

## Capabilities

### Modified Capabilities

- `functions-runtime`: requirement on the function-invocation handler and
  the dispatcher contract with OpenWhisk.

## Impact

- **Affected code**: new `apps/control-plane/src/functions-invoke.mjs`,
  `services/adapters/src/openwhisk-admin.mjs:1792-1812` (rewritten
  `dispatchWorkflowAction`), gateway-config route table to point the
  invoke route at the new handler upstream,
  `tests/e2e/functions/functions-invoke.test.mjs` (new),
  `tests/adapters/openwhisk-admin-dispatch.test.mjs` (new).
- **Migration required**: none in this adapter; the OpenWhisk client wiring
  belongs in the runtime config.
- **Breaking changes**: callers that relied on the synthetic `act_*_pending`
  id will start receiving real provider activation ids. The id shape
  changes; document the new format.
- **Out of scope**: provisioning of OpenWhisk itself (helm/charts); the
  audit publisher stub (covered by `fix-h1-audit-emitter-stub`); contract
  version fallbacks (covered by `fix-h1-public-url-and-contract-versions`).
