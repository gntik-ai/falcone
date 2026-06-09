async-operation actions trust caller-supplied callerContext for tenant/superadmin

**Change ID:** fix-async-operation-trusted-context
**Capability:** tenant-provisioning
**Type:** bug
**Priority:** P2
**OpenSpec change:** openspec/changes/fix-async-operation-trusted-context/

---

## Why

`async-operation-query` and `async-operation-create` both build their `callerContext` by returning `params.callerContext ?? {}` verbatim from the request payload. The `resolveTenantScope` function trusts `callerContext.actor.type === 'superadmin'` to grant a cross-tenant bypass and uses `callerContext.tenantId` as the authoritative data-scoping value. Because `params` originates from the OpenWhisk action invocation body, any caller who can reach these actions can inject `actor.type: 'superadmin'` or an arbitrary `tenantId` and read or create async operations for any tenant.

## What Changes

- Add a `buildCallerContext(params)` factory that reads `x-tenant-id`, `x-auth-subject`, and `x-actor-type` exclusively from `params.__ow_headers` (gateway-trusted), mirroring `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity`.
- Replace `getCallerContext(params)` with `buildCallerContext(params)` in both action files; reject with `401 UNAUTHORIZED` when required headers are absent.
- Remove the now-unused `getCallerContext` helper from both files.
- Update any in-repo internal callers that previously passed a `callerContext` body field to instead forward the gateway-trusted headers.
- No change to `resolveTenantScope` logic (it is correct once the input is trusted), no API surface change, no schema change.

---

## Spec delta (EARS)

### Requirement: Async-operation actions MUST NOT accept caller identity from the request payload

The system SHALL NOT derive `callerContext.tenantId`, `callerContext.actor.type`, or `callerContext.actor.id` from the raw incoming request body or action `params` object. The system SHALL source all caller identity fields exclusively from gateway-injected trusted headers (`x-tenant-id`, `x-auth-subject`, `x-actor-type`) or from a JWKS-verified token claim.

#### Scenario: Caller-supplied superadmin actor type is rejected (bbx-callercontext-trust)

- **WHEN** a caller invokes `async-operation-query` with `params.callerContext = { actor: { id: "x", type: "superadmin" }, tenantId: "ten_B" }` directly in the request payload, without valid gateway-trusted headers identifying the caller as a superadmin
- **THEN** the action returns HTTP 401 UNAUTHORIZED and does NOT return operations belonging to tenant ten_B

#### Scenario: Caller-supplied arbitrary tenantId in callerContext is rejected

- **WHEN** a caller invokes `async-operation-query` with `params.callerContext.tenantId` set to a tenant they do not own, without valid gateway-trusted headers mapping the caller to that tenant
- **THEN** the action returns HTTP 401 UNAUTHORIZED and no operations from the target tenant are disclosed

### Requirement: Trusted callerContext MUST be assembled from gateway headers at the action boundary

The system SHALL provide a `buildCallerContext(params)` factory that reads `x-tenant-id`, `x-auth-subject`, and `x-actor-type` from `params.__ow_headers` and returns a verified `callerContext` object. When the required headers are absent or empty the factory SHALL return `null` and the action SHALL respond with HTTP 401 UNAUTHORIZED.

#### Scenario: Missing gateway identity headers cause immediate rejection

- **WHEN** a caller invokes `async-operation-query` or `async-operation-create` without the gateway-injected `x-tenant-id` header
- **THEN** the action returns HTTP 401 UNAUTHORIZED and performs no database read or write

#### Scenario: Valid gateway headers produce a correctly scoped callerContext

- **WHEN** a caller invokes `async-operation-query` with gateway-injected headers `x-tenant-id: ten_A` and `x-actor-type: user`
- **THEN** `resolveTenantScope` scopes the query to tenant ten_A only, and the response contains only operations belonging to ten_A

---

## Tasks

### 1. Add Failing Black-Box Test

- [ ] 1.1 Add test `bbx-callercontext-trust` to `tests/blackbox/` that invokes `async-operation-query` with `callerContext: { actor: { id: "x", type: "superadmin" }, tenantId: "ten_B" }` in the request body (without gateway-trusted headers) and asserts the response is NOT 200 with tenant B's operations
- [ ] 1.2 Confirm the test fails (red) against the current unpatched code before proceeding

### 2. Implement the Fix

- [ ] 2.1 Add a `buildCallerContext(params)` factory in a shared helper (e.g., `services/provisioning-orchestrator/src/actions/caller-context.mjs`) that reads `x-tenant-id`, `x-auth-subject`, and `x-actor-type` exclusively from `params.__ow_headers`; return `null` when required headers are absent
- [ ] 2.2 Replace `getCallerContext(params)` with `buildCallerContext(params)` in `services/provisioning-orchestrator/src/actions/async-operation-query.mjs`; reject with `401 UNAUTHORIZED` when `buildCallerContext` returns `null`
- [ ] 2.3 Replace `getCallerContext(params)` with `buildCallerContext(params)` in `services/provisioning-orchestrator/src/actions/async-operation-create.mjs`; reject with `401 UNAUTHORIZED` when `buildCallerContext` returns `null`
- [ ] 2.4 Remove the now-unused `getCallerContext` helper from both action files
- [ ] 2.5 Update any in-repo internal callers that previously passed a `callerContext` body field to instead forward the gateway-trusted headers

### 3. Verify

- [ ] 3.1 Confirm `bbx-callercontext-trust` test now passes (green)
- [ ] 3.2 Run `bash tests/blackbox/run.sh` and confirm green

---

## Acceptance criteria

**bbx-callercontext-trust**: a caller invoking `async-operation-query` with `params.callerContext = { actor: { id: "x", type: "superadmin" }, tenantId: "ten_B" }` in the request body, without valid gateway-trusted headers, receives HTTP 401 UNAUTHORIZED and no tenant B operations are disclosed.

---

## Code evidence

- `services/provisioning-orchestrator/src/actions/async-operation-query.mjs::getCallerContext` — lines 42-43: `return params.callerContext ?? {}` — verbatim pass-through of caller-supplied object
- `services/provisioning-orchestrator/src/actions/async-operation-query.mjs::resolveTenantScope` — lines 69-82: `if (callerContext.actor?.type === 'superadmin')` grants cross-tenant bypass entirely from the untrusted callerContext
- `services/provisioning-orchestrator/src/actions/async-operation-query.mjs::main` — lines 173-181: callerContext consumed without provenance check
- `services/provisioning-orchestrator/src/actions/async-operation-create.mjs::getCallerContext` — lines 19-21: same verbatim pass-through
- `services/provisioning-orchestrator/src/actions/async-operation-create.mjs::main` — line 170: callerContext consumed without provenance check
- **Reference (correct pattern):** `services/scheduling-engine/actions/scheduling-management.mjs::parseIdentity` — reads identity from `params.__ow_headers` only

---

## Resolution (OpenSpec)

1. `/opsx:apply fix-async-operation-trusted-context` — implement the fix following tasks.md
2. `/opsx:verify fix-async-operation-trusted-context` — run the verify profile
3. `bash tests/blackbox/run.sh` — confirm green
4. `/opsx:archive fix-async-operation-trusted-context` — sync delta into openspec/specs/ and archive the change

Or use the wrapper: `/fix-bug fix-async-operation-trusted-context`

Optional real E2E: `/e2e-issue fix-async-operation-trusted-context`
