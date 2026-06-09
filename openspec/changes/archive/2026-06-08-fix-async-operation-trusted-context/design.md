## Context

`async-operation-query.mjs::getCallerContext` (line 42-43) and `async-operation-create.mjs::getCallerContext` (lines 19-21) both return `params.callerContext ?? {}` verbatim. The `resolveTenantScope` function (query, lines 69-82) trusts `callerContext.actor.type === 'superadmin'` to grant a cross-tenant bypass, and trusts `callerContext.tenantId` as the authoritative data-scoping value. Because `params` originates from the OpenWhisk action invocation body, any caller who can invoke these actions can supply arbitrary values for `actor.type` and `tenantId`.

The gateway already injects `X-Tenant-Id` from the verified token before forwarding to OpenWhisk actions, as shown by `services/gateway-config/base/public-api-routing.yaml`. The scheduling engine establishes the reference pattern: `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` reads `x-tenant-id`, `x-workspace-id`, `x-auth-subject` from `params.__ow_headers` and never touches the request body for identity.

These two actions are invoked internally (by other sagas and orchestration layers) rather than directly by end-user HTTP requests, which is why they accept a structured `callerContext` rather than raw headers. That design is acceptable, but the caller must be forced to use a trusted construction path at the action boundary.

## Goals / Non-Goals

**Goals:**
- Ensure `callerContext.tenantId` and `callerContext.actor.type` cannot be set by an untrusted caller via the request payload.
- Provide a `buildCallerContext(params)` factory that reads identity from gateway-trusted headers only.
- Reject any invocation that lacks the required gateway headers with `401 UNAUTHORIZED`.
- Leave `resolveTenantScope` logic unchanged (it is correct once the input is trusted).

**Non-Goals:**
- Changing how internal orchestration callers invoke these actions (they will be updated to pass the required headers).
- Modifying the async-operation database schema.
- Changing the public API surface of the actions.

## Decisions

**Decision: Build callerContext from gateway headers inside the action, discard any caller-supplied callerContext.**
Rationale: Consistent with `parseIdentity` in scheduling-engine. The caller-supplied `callerContext` pattern is replaced by a header-to-context constructor. Internal callers that previously built the callerContext object will instead ensure the gateway headers are forwarded, which is how all other action-to-action invocations work.

**Alternative considered:** Validate a signed envelope around `callerContext` so that internal callers can still pass a structured object. Rejected: introduces a new signing/verification mechanism and complexity not present elsewhere in the codebase. Header forwarding is sufficient and consistent.

## Risks / Trade-offs

**Risk:** Internal orchestration layers that currently build and pass `callerContext` directly will break until they are updated to forward gateway headers instead.
**Mitigation:** The change is applied atomically — both the action fix and the corresponding callers (if any in-repo) are updated in the same PR. Any callers not in this repo are protected by the gateway's header injection.

**Risk:** In a pure internal invocation path (action-to-action without a gateway hop), there may be no gateway to inject the headers.
**Mitigation:** For action-to-action calls, the invoking action must extract identity from its own trusted context and pass it as `x-tenant-id` / `x-actor-type` in the invocation headers — the same discipline applied to scheduling triggers.

## Migration Plan

No schema changes. No API surface changes. The fix replaces `getCallerContext(params)` with `buildCallerContext(params)` in both action files. Any internal callers that supply a `callerContext` body field will need to instead supply the gateway-trusted headers. Rollout is a single coordinated deploy; no data migration is required.
