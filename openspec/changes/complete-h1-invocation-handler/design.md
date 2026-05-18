## Context

`POST /v1/functions/{id}/invoke` is declared in the OpenAPI fragment
`apps/control-plane/openapi/families/functions.openapi.json` and gated by the
APISIX route table, but no handler in this repo consumes
`buildOpenWhiskAdminAdapterCall` to actually invoke an OpenWhisk action. The
nearest production-shaped helper, `dispatchWorkflowAction` at
`services/adapters/src/openwhisk-admin.mjs:1792-1812`, returns a synthetic
activation envelope (`act_${slug}_${'pending'}`) without validating inputs.

This is a `complete-*` change because the invocation runtime does not exist
in this repo at all — it is not a buggy code path to repair.

## Goals

- Stand up the `POST /v1/functions/{id}/invoke` handler in the control plane
  with sync/async semantics.
- Replace `dispatchWorkflowAction` with a real dispatcher that validates
  inputs, calls an injected `OpenWhiskClient`, and returns the real
  provider activation id.
- Wire activation-id propagation through the audit envelope.

## Non-goals

- Provisioning of the OpenWhisk control plane itself (helm/charts; covered
  separately).
- Trigger registration (covered by `harden-h1-trigger-validation`).
- Function package storage / code-build pipelines.

## Decisions

### Decision 1: Where the handler lives

A new module `apps/control-plane/src/functions-invoke.mjs` exposes a
`createFunctionsInvokeHandler({ openWhiskClient, publishAuditEvent, audit
context })` factory. The gateway-config route table points the upstream at
the route this module exposes. The module re-uses `buildOpenWhiskAdminAdapterCall`
from the adapter for request normalisation, then dispatches via the client.

### Decision 2: OpenWhisk client interface

```
interface OpenWhiskClient {
  invokeAction({ namespace, actionRef, payload, headers, responseMode }):
    Promise<{ activationId, status, result?, error? }>;
  pollActivation({ activationId }):
    Promise<{ activationId, status, result?, error? }>;
}
```

The client is injected — production wires it to the OpenWhisk REST API;
tests pass a stub. The handler does not import any OpenWhisk SDK directly.

### Decision 3: Synchronous vs asynchronous semantics

- `responseMode: 'synchronous'` → the handler awaits the client's
  `invokeAction` and returns the activation result inline. Default
  timeout is 30 s; longer than that returns `504 INVOCATION_TIMEOUT` and
  the activation continues asynchronously.
- `responseMode: 'asynchronous'` → the handler awaits only the activation
  acknowledgement (activation id), then returns `{activationId,
  statusPollUrl: '/v1/activations/{activationId}'}` with HTTP 202.

### Decision 4: Activation-id propagation through audit

The audit envelope built by the function-admin contract gets the real
`activationId` populated by the dispatcher; the previous synthetic
`act_${slug}_${'pending'}` is removed. Audit consumers link a function
invocation to its OpenWhisk activation through this id.

### Decision 5: Feature flag

`OPENWHISK_INVOCATION_DISABLED=true` (default false) makes the handler
return `503 INVOCATION_DISABLED` immediately. This lets a deployment opt
out without breaking the contract layer; the previous behaviour of
silently producing a synthetic activation is removed.

## Risks / Trade-offs

- Synchronous invocations holding HTTP connections for up to 30 s is a
  resource cost; document the recommendation that long-running actions
  use async mode.
- The dispatcher's input validation will reject requests that today
  silently succeed with a synthetic id; document the breakage.

## Migration plan

1. Land the handler and dispatcher rewrite behind
   `OPENWHISK_INVOCATION_DISABLED=true` by default, so existing
   deployments see `503` rather than synthetic activations.
2. Provision the OpenWhisk client in deployments that want real
   invocations; flip the feature flag.
3. Remove the synthetic-activation fallback after one release cycle.
