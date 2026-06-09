## Why

`async-operation-query` and `async-operation-create` build their `callerContext` entirely from the caller-supplied `params.callerContext` object — including `callerContext.tenantId` and `callerContext.actor.type`. `resolveTenantScope` (query, lines 69-82) grants a superadmin bypass and cross-tenant access solely when `callerContext.actor.type === 'superadmin'`. Because the action never validates that `callerContext` was populated from a verified/trusted source, any caller who can reach these actions can inject `actor.type: 'superadmin'` or an arbitrary `tenantId` and read or create async operations for any tenant.

The underlying logic in `resolveTenantScope` is sound; the vulnerability is the trust boundary: `callerContext` must be assembled from gateway-trusted headers or JWKS-verified claims before it enters the action, not accepted verbatim from the request body.

## What Changes

- Document and enforce the invariant that `callerContext` MUST be derived from a trusted upstream source (verified gateway headers or JWKS-verified token claims), never from the raw request payload.
- Add a defensive guard at the action entrypoint in `async-operation-query.mjs` and `async-operation-create.mjs` that rejects requests where `callerContext` arrives via an untrusted path (i.e., is present in `params` without a corresponding gateway-trusted identity marker).
- Provide a reference `buildCallerContext(params)` factory that reads identity exclusively from gateway-injected headers (`x-tenant-id`, `x-auth-subject`, `x-actor-type`), mirroring `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`.
- Any invocation that cannot produce a trusted `callerContext` is rejected with `401 UNAUTHORIZED`.
- No change to the API surface or the database schema; the `resolveTenantScope` logic itself is correct and unchanged.

## Capabilities

### New Capabilities

- `tenant-provisioning`: Async-operation actions derive caller context exclusively from gateway-trusted headers; caller-supplied callerContext values for tenantId and actor.type are never accepted from the request payload.

### Modified Capabilities

## Impact

- `services/provisioning-orchestrator/src/actions/async-operation-query.mjs::getCallerContext` (lines 42-43) — returns `params.callerContext ?? {}` verbatim
- `services/provisioning-orchestrator/src/actions/async-operation-query.mjs::resolveTenantScope` (lines 69-82) — superadmin bypass and tenant scope derive entirely from the untrusted callerContext
- `services/provisioning-orchestrator/src/actions/async-operation-query.mjs::main` (lines 173-181) — callerContext consumed without verifying its provenance
- `services/provisioning-orchestrator/src/actions/async-operation-create.mjs::getCallerContext` (lines 19-21) — same verbatim pass-through
- `services/provisioning-orchestrator/src/actions/async-operation-create.mjs::main` (line 170) — callerContext consumed without verifying its provenance
