# Implementation Plan: Function Quota Guardrails

**Branch**: `003-function-quota-guardrails` | **Date**: 2026-03-27 | **Spec**: `specs/003-function-quota-guardrails/spec.md`  
**Input**: Feature specification from `/specs/003-function-quota-guardrails/spec.md`

## Summary

Extend the governed `functions` surface so tenant-level and workspace-level quota guardrails can be evaluated and enforced consistently for function count, invocation count, cumulative compute time, and cumulative memory usage. Keep the increment bounded to contract updates, helper modeling, quota evaluation logic, and executable tests that fit the current monorepo maturity. The feature must reject quota-exceeding actions before completion, keep scope isolation intact, and expose quota posture only for the caller’s own tenant/workspace context.

## Technical Context

**Language/Version**: Node.js 20+ compatible ESM modules, JSON OpenAPI artifacts, Markdown planning assets  
**Primary Dependencies**: Node built-in `node:test`, existing public API contract generation/validation scripts, existing governed OpenWhisk helper modules, existing functions API family contracts  
**Storage**: repository contract/helper artifacts only in this increment; quota state is governed product metadata and not a new persistent subsystem in this task  
**Testing**: root validation scripts plus unit, adapter, and contract test suites  
**Target Platform**: local Linux/macOS shells and GitHub Actions Ubuntu runners  
**Project Type**: monorepo control-plane/API governance increment for a multi-tenant BaaS platform  
**Performance Goals**: quota evaluation remains deterministic and pre-commit; concurrent requests must not overshoot a configured limit  
**Constraints**: preserve tenant/workspace isolation, avoid secrets/versioning/audit sibling scope, stay compatible with OpenWhisk-governed function administration, keep changes root-validated  
**Scale/Scope**: one quota model extension, one quota enforcement path, one visibility surface extension, and matching tests/documentation

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — OpenAPI stays under `apps/control-plane`, reusable helper logic stays under `services/`, and tests stay under `tests/`.
- **Incremental Delivery First**: PASS — the work extends existing governed function contracts and helpers instead of introducing a new runtime service.
- **Kubernetes and OpenShift Compatibility**: PASS — no deployment artifacts or cluster assumptions are introduced by this increment.
- **Quality Gates at the Root**: PASS — the feature can be validated through existing root OpenAPI and test commands.
- **Documentation as Part of the Change**: PASS — spec, plan, and task artifacts remain in the feature branch.
- **Cross-Scope Isolation**: PASS — quota posture and enforcement must remain isolated to the caller’s tenant/workspace context.

## Project Structure

### Documentation (this feature)

```text
specs/003-function-quota-guardrails/
├── spec.md
├── plan.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/
└── control-plane/
    ├── openapi/
    │   └── families/
    │       └── functions.openapi.json          ← extend quota schema(s), inventory and quota routes
    └── src/
        └── functions-admin.mjs                 ← expose quota surface summary and compatibility flags

services/
├── adapters/
│   └── src/
│       └── openwhisk-admin.mjs                 ← quota guardrail resolution, enforcement helpers, and error mapping
└── internal-contracts/
    └── src/
        └── public-route-catalog.json           ← regenerated after OpenAPI update if new route IDs are added

tests/
├── adapters/
│   └── openwhisk-admin.test.mjs               ← extend with quota validation/enforcement coverage
├── contracts/
│   └── functions-quota.contract.test.mjs      ← new contract test file
└── unit/
    └── functions-admin.test.mjs               ← extend with quota route/surface assertions
```

**Structure Decision**: Keep quota guardrails inside the existing `functions` API family and the existing adapter/helper surface. Do not introduce a new top-level package or a separate quota service; the implementation should extend the current control-plane contracts and OpenWhisk helper patterns.

## Target Architecture and Flow

1. The functions inventory surface remains the primary read model for callers, but its `quotaStatus` payload is expanded to describe both tenant-level and workspace-level guardrails.
2. Quota evaluation happens before a quota-affecting action is accepted: function create/update, function invocation, and any lifecycle mutation that increases consumption.
3. The adapter resolves the strictest applicable guardrail for the caller’s tenant and workspace before state changes are committed. The same scope resolution path is used for all four quota dimensions.
4. Quota dimensions are tracked independently: function count, invocation count, cumulative compute time, and cumulative memory usage. A request can be allowed by one dimension and blocked by another.
5. When both tenant-level and workspace-level limits exist, the most restrictive applicable limit wins. The response must identify the scope and dimension that blocked the action without exposing another tenant’s or workspace’s posture.
6. Concurrency safety is enforced in the adapter/validation path so concurrent requests cannot overshoot the limit boundary. The plan assumes the backing product metadata or transaction boundary already available in the current control-plane patterns is reused for atomicity.
7. Visibility is limited to authorized operators within the same tenant/workspace. Read surfaces return the caller’s own quota posture only, and rejected operations use non-sensitive error envelopes.

## Artifact-by-Artifact Change Plan

### `apps/control-plane/openapi/families/functions.openapi.json`

- Expand `FunctionQuotaStatus` from a workspace-only counters object into a structured quota model that can represent:
  - tenant scope and workspace scope
  - function count, invocation count, cumulative compute time, and cumulative memory usage
  - used, limit, and remaining values per dimension where applicable
  - the blocking scope/dimension when a limit is exceeded
- Add or extend a quota evaluation schema for rejected actions so callers can tell which dimension and scope triggered the denial without exposing unrelated metadata.
- Add dedicated quota summary routes if the current family lacks a standalone accessor for quota posture:
  - `GET /v1/functions/tenants/{tenantId}/quota`
  - `GET /v1/functions/workspaces/{workspaceId}/quota`
- Keep `GET /v1/functions/workspaces/{workspaceId}/inventory` aligned with the expanded quota model so existing inventory consumers continue to see quota posture in context.
- Extend any function action / invocation response envelopes that need to surface quota posture or blocking metadata, but avoid duplicating sensitive values across multiple read models.
- Preserve existing path shapes and route families where possible so derived route catalogs stay stable.

### `apps/control-plane/src/functions-admin.mjs`

- Expose quota-aware route capabilities through `summarizeFunctionsAdminSurface()` so the functions admin summary reflects quota posture access alongside the existing lifecycle and workspace surfaces.
- Add a quota capability summary entry for tenant/workspace limits and keep the action list explicit for discoverability.
- Update the compatibility summary to indicate that quota guardrails are supported and governed at the product boundary.
- Keep all existing route helper exports and lifecycle summaries intact.

### `services/adapters/src/openwhisk-admin.mjs`

- Extend quota guardrail resolution to cover tenant and workspace scope together, not just workspace-only counters.
- Add or extend validation helpers for quota-bearing requests so the adapter can:
  - compute the strictest applicable limit
  - reject requests that would exceed function count, invocation count, cumulative compute time, or cumulative memory usage
  - emit dimension-specific and scope-specific violations
- Add a stable quota projection builder that can produce the caller’s quota posture for read responses without leaking other scopes.
- Keep the current tenant/workspace isolation model intact; the adapter should not infer cross-scope data.
- Ensure the error normalization path maps quota failures to clear, non-sensitive denial codes that distinguish the quota dimension and scope.
- Preserve existing function/version/secret helper behavior unchanged.

### `services/internal-contracts/src/`

- Regenerate any derived route catalog or public-contract artifacts needed after OpenAPI changes so quota routes and schemas remain discoverable through the public contract helpers.
- Confirm the generated catalog reflects any new quota operation IDs without manual edits.

### `tests/unit/functions-admin.test.mjs`

- Assert the functions admin surface summary includes quota guardrail capability information.
- Assert the new quota route IDs are discoverable if dedicated quota routes are added.
- Keep the existing lifecycle and secret assertions passing unchanged.

### `tests/adapters/openwhisk-admin.test.mjs`

- Cover quota resolution across tenant and workspace scope.
- Add cases for each quota dimension:
  - function count
  - invocation count
  - cumulative compute time
  - cumulative memory usage
- Add negative-path tests for strictest-limit precedence, cross-scope isolation, and concurrent threshold handling.
- Assert quota denials produce clear, non-sensitive violations and do not leak another scope’s limits.

### `tests/contracts/functions-quota.contract.test.mjs`

- Validate the updated OpenAPI document exposes the expanded quota schema and any new quota summary routes.
- Assert `FunctionQuotaStatus` can represent both tenant and workspace guardrails and includes all four quota dimensions.
- Assert inventory or dedicated quota responses remain scope-bound and contract-valid.
- Assert quota rejection responses use the expected error envelope and are discoverable through the public route catalog if new routes are added.

## Data Model and Metadata Impact

Introduce the following governed concepts for this feature increment:

| Entity | Role | Notable fields |
|--------|------|----------------|
| `FunctionQuotaStatus` | Scope-bound quota posture for tenant or workspace | scope, scopeId, dimension statuses, used, limit, remaining, blockedReason |
| `FunctionQuotaDimensionStatus` | Single quota dimension posture | `name`, `used`, `limit`, `remaining`, `blocked` |
| `FunctionQuotaEvaluation` | Result of evaluating a request against scope quotas | `allowed`, `violations[]`, `effectiveScope`, `effectiveLimit` |
| `FunctionQuotaViolation` | Structured denial reason | `scope`, `dimension`, `limit`, `used`, `remaining` |

The quota model must keep tenant and workspace data separate while still allowing the adapter to enforce the strictest effective limit for the caller’s scope. Cumulative compute time and memory usage should be represented as aggregated product metadata, not as raw runtime internals in the read model.

## API and UX Considerations

- **Visibility boundary**: quota posture is only visible for the caller’s own tenant/workspace context. There is no cross-scope quota browsing in this increment.
- **Operator clarity**: rejection responses should identify whether the block came from function count, invocation count, compute time, or memory usage, and whether the applicable scope was tenant-level or workspace-level.
- **Inventory compatibility**: existing inventory consumers should continue to receive quota posture in-context, even if dedicated quota routes are introduced.
- **No secret/version scope creep**: this increment must not rework secrets, rollback, import/export, or audit surfaces beyond whatever quota metadata is needed for this feature.
- **Console behavior**: this task focuses on backend contract and governance behavior; no new UI work is required unless a future story explicitly consumes the quota summary surface.

## Testing Strategy

### Unit

- Route exposure and quota capability summary checks in `tests/unit/functions-admin.test.mjs`.
- Compatibility flag assertions for quota guardrails support.

### Adapter

- Validation and normalization tests for tenant/workspace quota resolution and dimension-specific violations in `tests/adapters/openwhisk-admin.test.mjs`.
- Tests for strictest-limit precedence, concurrency guardrail behavior, and cross-scope isolation.

### Contract

- OpenAPI contract assertions for the expanded quota schemas and any dedicated quota routes in `tests/contracts/functions-quota.contract.test.mjs`.
- Validation that `FunctionInventory.quotaStatus` remains valid after the schema expansion.

### E2E

- No new runtime E2E environment in this task. Quota behavior is represented through contract and helper behavior only.

### Operational validation

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:openapi
npm run test:unit
npm run test:adapters
npm run test:contracts
npm run lint
```

## Risks and Mitigations

- **Risk**: Concurrent requests overshoot the last available quota unit.  
  **Mitigation**: Reuse the existing governed validation/commit boundary and require quota evaluation to be atomic in the adapter path.

- **Risk**: Tenant and workspace quota data bleed into each other.  
  **Mitigation**: Keep scope IDs explicit in the read model and enforce scope matching in validation helpers.

- **Risk**: Compute time and memory aggregation is inconsistent across actions and invocations.  
  **Mitigation**: Define one canonical quota aggregation path in the adapter and assert it in tests before wiring any new response surfaces.

- **Risk**: Route/catalog regeneration misses newly added quota endpoints.  
  **Mitigation**: Make public-route catalog regeneration part of the implementation sequence and assert discoverability in contract tests.

- **Risk**: The quota feature starts pulling in sibling work such as secrets, versioning, or audit.  
  **Mitigation**: Keep the scope bounded to guardrail enforcement and visibility only; do not add unrelated lifecycle or audit behaviors in this task.

## Recommended Implementation Sequence

1. Finalize the quota schema and visibility model in `functions.openapi.json`.
2. Extend `functions-admin.mjs` so the quota surface is discoverable in the admin summary.
3. Update `openwhisk-admin.mjs` with tenant/workspace guardrail resolution and dimension-specific violation mapping.
4. Regenerate derived public contract artifacts if new route IDs are introduced.
5. Add unit, adapter, and contract tests for quota visibility and enforcement.
6. Run root validation commands and fix any contract/test drift before committing.

## Parallelization Notes

- OpenAPI contract updates and helper-module updates can proceed in parallel once the quota schema shape is fixed.
- Unit tests can be authored while adapter behavior is being extended, provided the route names and helper signatures are stable.
- Contract tests should start after the quota schema names and any dedicated route names are finalized.
- Public-route catalog regeneration must happen after the OpenAPI update and before catalog assertions are finalized.

## Done Criteria

- The `functions` API family exposes a quota posture surface that supports tenant and workspace scopes.
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

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Separate tenant/workspace quota posture from the existing workspace-only counters | The task explicitly requires limits at both tenant and workspace scopes; collapsing them would make strictest-limit enforcement impossible to describe or validate | A single shared quota object would hide which scope blocked the request and would weaken cross-scope isolation checks |
| Model function count, invocation count, compute time, and memory usage independently | The story requires distinct quota dimensions and distinct rejection behavior | Treating all consumption as one aggregate value would lose operator clarity and make tests ambiguous |
| Keep inventory-compatible quota posture plus optional dedicated quota routes | Existing consumers already read `quotaStatus` from inventory, but the product needs a clearer quota surface for operators | Replacing inventory-only visibility without a dedicated accessor would make quota posture harder to discover and harder to test |
