# add-function-caller-context

## Change type
enhancement

## Capability
functions

## Priority
P2

## Why

When a Knative function is invoked on the kind runtime, the runtime receives ONLY the
user-controlled `params` body — no verified caller context (tenant, workspace, principal,
roles) reaches the function. Live-probed: an invocation returns `seenEnv=[]` (no identity
env vars). This means a function cannot do any identity-aware work — it cannot check which
tenant owns the call, cannot gate behavior by role, and cannot log a meaningful principal.

Root cause (code-verified):
`deploy/kind/control-plane/fn-handlers.mjs::fnInvoke` (line 155) has the verified caller
identity in `ctx.identity` (`{sub, tenantId, workspaceId, actorType, roles, scopes}`,
derived from the JWT by the control-plane server) and the resolved function row `r` (with
`r.workspace_id`), but calls `invokeKnative(ksvcHost(r.ksvc_name), params, {timeoutMs})`
passing ONLY `params` — identity is silently discarded.

`deploy/kind/control-plane/function-executor.mjs::invokeKnative` (line 137) HTTP POSTs
`params` as the JSON body to the function's cluster-internal Knative service; the only
headers set are `content-type` and `content-length`.

`deploy/kind/fn-runtime/server.mjs` (line 43) calls `main(params)` with only the parsed
body — no context argument. Env on the function container is deploy-time only (`FN_SRC` +
workspace secrets), so there is no other vector for delivering per-invocation identity.

GitHub issue #639.

## What Changes

- **`deploy/kind/control-plane/fn-handlers.mjs::fnInvoke`**: build a `caller` object from
  the verified `ctx.identity` (tenantId, principal=sub, roles, actorType) and the resolved
  function row (`workspaceId = r.workspace_id ?? ctx.identity.workspaceId`); pass it as
  `{ timeoutMs, caller }` to `invokeKnative`.
- **`deploy/kind/control-plane/function-executor.mjs::invokeKnative`**: accept a `caller`
  option; inject `X-Falcone-Tenant-Id`, `X-Falcone-Workspace-Id`, `X-Falcone-Principal`,
  `X-Falcone-Actor-Type`, and `X-Falcone-Roles` (comma-joined) as HTTP request headers.
  Export a pure `buildInvokeHeaders(payload, caller)` as a deterministic test seam.
- **`deploy/kind/fn-runtime/server.mjs`**: export a pure `callerContextFromHeaders(headers)`
  that maps the five `X-Falcone-*` headers to a `{ tenantId, workspaceId, principal,
  actorType, roles }` object (roles split on comma, empty string yields empty array). Call
  `main(params, callerContextFromHeaders(req.headers))` — the context is NEVER derived from
  the parsed body. Export `server` so in-process tests can import the module without binding
  a port.
- Out of scope: the parallel product executor
  `apps/control-plane/src/runtime/functions-executor.mjs` (the `tests/env` path) — noted
  as a follow-up for parity; this change targets the live kind Knative path the issue cites.
  No new identity claims, no per-function RBAC.

## Capabilities

### New Capabilities

### Modified Capabilities
- `functions`: add requirement that invoked functions receive a verified, tamper-proof caller
  context (tenant, workspace, principal, roles, actorType) as a second `context` argument.

## Impact

- Every Knative function invocation in the kind runtime now carries `X-Falcone-*` HTTP
  headers injected by the control-plane (in-cluster; not user-reachable).
- The fn-runtime image exposes the context as `main(params, context)`. Existing functions
  that define only `main(params)` ignore the second argument — backward compatible.
- The user-supplied `params` body cannot influence the `context` arg: the runtime reads
  context exclusively from request headers, which are injected server-side.
- Affected specs: `functions`.
- Follow-up required: `apps/control-plane/src/runtime/functions-executor.mjs` (tests/env
  product executor path) for parity with this change.
