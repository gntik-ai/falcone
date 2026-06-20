## Context

The Falcone kind runtime dispatches serverless functions over a cluster-internal HTTP call
from the control-plane (`deploy/kind/control-plane/function-executor.mjs::invokeKnative`)
to the per-function Knative Service (`deploy/kind/fn-runtime/server.mjs`). The control-plane
resolves the caller's verified JWT identity into `ctx.identity` (`{sub, tenantId,
workspaceId, actorType, roles, scopes}`) before reaching `fnInvoke`
(`deploy/kind/control-plane/fn-handlers.mjs`, line 143). The function row `r` (returned by
`store.getFnAction`) carries `r.workspace_id`, which is the authoritative workspace for the
resource being invoked.

Today `invokeKnative` receives only `(host, params, { timeoutMs })` — identity is dropped at
the call site (fn-handlers.mjs, line 155). The fn-runtime calls `main(params)` with no
context (server.mjs, line 43). There is no other per-invocation identity vector: container
env is deploy-time only.

## Goals / Non-Goals

**Goals:**
- Thread the verified caller identity from `ctx.identity` and `r.workspace_id` through the
  executor's HTTP call as tamper-proof in-cluster headers.
- Expose it to user code as `main(params, context)` — a separate, second argument so the
  body cannot shadow it.
- Keep backward compatibility: `main(params)` functions ignore the extra arg without error.
- Provide pure exported functions (`buildInvokeHeaders`, `callerContextFromHeaders`) as
  deterministic unit-test seams, decoupled from live HTTP/socket logic.

**Non-Goals:**
- Parity with `apps/control-plane/src/runtime/functions-executor.mjs` (the tests/env product
  executor) — noted as a follow-up.
- New identity claims or per-function RBAC enforcement inside the runtime.
- Propagating context over the public API (the X-Falcone-* headers are injected server-side
  over the cluster-internal path only; callers never send them).

## Decisions

1. **Send side (`fnInvoke`)**: build `caller = { tenantId: ctx.identity.tenantId, workspaceId:
   r.workspace_id ?? ctx.identity.workspaceId, principal: ctx.identity.sub, roles:
   ctx.identity.roles, actorType: ctx.identity.actorType }` and pass it to
   `invokeKnative(host, params, { timeoutMs, caller })`.

2. **Executor (`invokeKnative` + `buildInvokeHeaders`)**: export a pure
   `buildInvokeHeaders(payload, caller)` that returns the headers object (content-type,
   content-length, plus the five `X-Falcone-*` headers when `caller` is provided).
   `invokeKnative` composes `buildInvokeHeaders` to build the `http.request` headers map.
   `roles` is serialized as a comma-joined string; absent `caller` or absent fields are
   simply omitted from the headers. Because `invokeKnative` hard-codes port 80 (cluster-
   internal), the header-building logic is unit-tested via `buildInvokeHeaders` without
   a live socket.

3. **Receive side (`fn-runtime/server.mjs` + `callerContextFromHeaders`)**: export a pure
   `callerContextFromHeaders(headers)` that reads the five `X-Falcone-*` headers from an
   incoming `http.IncomingMessage` headers object, returns `{ tenantId, workspaceId,
   principal, actorType, roles }` (roles split on `,`, trimmed, filtered to non-empty;
   absent headers yield `undefined` or `[]` for roles). The request handler calls
   `main(params, callerContextFromHeaders(req.headers))`. Context is NEVER read from `params`
   or `body`.

4. **Port-guard for testability**: the `server.listen(PORT, …)` call is conditional on
   `!process.env.OPENSPEC_TEST` (or equivalent guard), so the module can be imported by
   in-process tests without binding a port. `server` is exported for in-process end-to-end
   tests.

5. **Tamper-proofing boundary**: the `X-Falcone-*` headers are injected exclusively by the
   control-plane over the cluster-internal path. The Knative Service is not exposed externally
   — only the control-plane can reach port 80 on the ksvc cluster DNS name. The fn-runtime
   reads context from headers (not body), enforcing the separation.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| `roles` serialization round-trip: empty array vs absent header | `buildInvokeHeaders` omits the header when roles is empty; `callerContextFromHeaders` returns `[]` for absent or blank header |
| Backward compat: `main(params)` ignores extra arg | JavaScript functions silently ignore extra args — no runtime error |
| Product executor parity gap (`apps/control-plane/src/runtime/functions-executor.mjs`) | Noted explicitly as out of scope; tracked as a follow-up enhancement |
| In-cluster header injection only — not end-to-end encrypted | Knative ksvc is not publicly reachable; header injection is purely server-side; acceptable for current threat model |
