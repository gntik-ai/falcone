# Tasks: Function Quota Guardrails

**Input**: Design documents from `/specs/003-function-quota-guardrails/`  
**Prerequisites**: `plan.md`, `spec.md`, `checklists/requirements.md`  
**Branch**: `003-function-quota-guardrails`  
**Story**: `US-FN-03-T03`

**Tests**: Unit, adapter, and contract coverage are required for this feature because tenant/workspace isolation, quota enforcement, and non-overshoot behavior must remain verifiable through root quality gates.

**Organization**: Tasks are grouped by phase so the quota guardrail increment remains independently testable.

## Format: `[ID] [P?] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependency overlap)
- Include exact file paths in every task

---

## Phase 1: Setup (Spec Artifact Finalization)

**Purpose**: Confirm the spec package is complete and the branch is ready for implementation.

- [x] T001 Confirm `specs/003-function-quota-guardrails/spec.md` is finalized and on the feature branch
- [x] T002 Confirm `specs/003-function-quota-guardrails/plan.md` is finalized and on the feature branch
- [ ] T003 Create the execution task list in `specs/003-function-quota-guardrails/tasks.md`

---

## Phase 2: Foundational (Blocking All Quota Work)

**Purpose**: Establish the OpenAPI schema additions, route shape, and helper boundaries that all quota enforcement and visibility tests depend on. Nothing downstream can be written or validated until the operation IDs, schema names, and guardrail semantics are stable.

**⚠️ CRITICAL**: No quota scenario is complete until these tasks land and `npm run generate:public-api` passes.

- [ ] T004 Add tenant/workspace quota routes and expanded quota schemas to `apps/control-plane/openapi/families/functions.openapi.json`:
  - `GET /v1/functions/tenants/{tenantId}/quota` → `getFunctionTenantQuota`
  - `GET /v1/functions/workspaces/{workspaceId}/quota` → `getFunctionWorkspaceQuota`
  - Expand `FunctionQuotaStatus` so it can represent tenant- and workspace-scoped guardrails for function count, invocation count, cumulative compute time, and cumulative memory usage
  - Keep `FunctionInventory.quotaStatus` aligned with the expanded quota model
  - Add any dedicated quota evaluation / violation schema needed by the contract surface

- [ ] T005 [P] Extend `apps/control-plane/src/functions-admin.mjs` so the functions admin surface advertises quota guardrail support, including a clear quota capability summary and any route IDs introduced in T004.

- [ ] T006 [P] Extend `services/adapters/src/openwhisk-admin.mjs` with quota guardrail resolution and enforcement primitives:
  - resolve tenant/workspace scope precedence
  - compute the strictest effective limit
  - classify violations by quota dimension and scope
  - keep the current tenant/workspace isolation behavior intact

- [ ] T007 Regenerate derived public contract helpers in `services/internal-contracts/src/` and any root generation scripts that consume the `functions` family after the OpenAPI update.

**Checkpoint**: The quota schema, helper surface, and route catalog are stable enough for test authoring.

---

## Phase 3: Verification Coverage (Blocking Implementation Drift)

**Purpose**: Add the test coverage that proves the new quota contract and helper behavior before the implementation is finalized.

- [ ] T008 [P] Extend `tests/unit/functions-admin.test.mjs` with assertions for quota route exposure, quota capability summary, and any compatibility flags that indicate tenant/workspace quota support.

- [ ] T009 [P] Extend `tests/adapters/openwhisk-admin.test.mjs` with quota validation and enforcement coverage:
  - tenant/workspace scope matching
  - strictest-limit precedence
  - function count, invocation count, compute time, and memory dimension handling
  - non-sensitive denial mapping
  - concurrent threshold behavior that does not overshoot the limit

- [ ] T010 [P] Add `tests/contracts/functions-quota.contract.test.mjs` to validate the expanded `functions` OpenAPI family, the new quota routes, the quota status schema, and the discoverability of the quota operation IDs through the public route catalog.

**Checkpoint**: Quota behavior is now test-covered at the unit, adapter, and contract layers.

---

## Phase 4: Implementation (Quota Guardrail Behavior)

**Purpose**: Finalize the runtime-visible quota posture and enforcement behavior in the repo’s existing control-plane and adapter surfaces.

- [ ] T011 Implement the quota read model and visibility surface in `apps/control-plane/openapi/families/functions.openapi.json` so tenant/workspace quota posture is represented consistently in inventory and quota summary responses.

- [ ] T012 Implement the quota summary exports in `apps/control-plane/src/functions-admin.mjs` so callers and tests can discover quota support from the functions admin surface.

- [ ] T013 Implement the quota enforcement and violation normalization flow in `services/adapters/src/openwhisk-admin.mjs` so rejected actions are blocked before completion and report the correct scope/dimension.

**Checkpoint**: The functions surface can now describe and enforce quota guardrails for tenant and workspace scopes.

---

## Phase 5: Validation and Readiness

**Purpose**: Prove the branch is ready for PR/CI handoff.

- [ ] T014 Run `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` from the repo root, then fix any contract or test drift before proceeding to push/PR work.

---

## Parallelization Notes

- T005 and T006 can proceed in parallel once the quota route and schema shape from T004 is fixed.
- T008, T009, and T010 can proceed in parallel once the operation IDs and schema names from T004 are stable.
- T012 and T013 should wait until the helper signatures and quota model from T006 are stable.
- T014 must run after the implementation tasks are complete and the generated contract artifacts are in sync.

## Done Criteria

- The `functions` API family exposes quota posture for tenant and workspace scopes.
- Quota guardrails are enforced for function count, invocation count, cumulative compute time, and cumulative memory usage.
- The strictest applicable limit wins when tenant and workspace quotas overlap.
- Concurrent requests do not allow a scope to exceed its configured quota.
- Quota posture is visible only for the caller’s own scope, and denials remain non-sensitive.
- Automated tests cover quota visibility, enforcement, and negative isolation cases.
- Root validation commands pass without breaking existing governed function behavior.
- Scope remains bounded to `US-FN-03-T03`.

## Expected Evidence

- Updated OpenAPI family diff showing quota schema and route changes.
- Updated helper-module diffs for `functions-admin.mjs` and `openwhisk-admin.mjs`.
- New or extended unit, adapter, and contract tests.
- Passing output from `npm run generate:public-api`, `npm run validate:public-api`, `npm run validate:openapi`, `npm run test:unit`, `npm run test:adapters`, `npm run test:contracts`, and `npm run lint` captured before the PR is opened.
