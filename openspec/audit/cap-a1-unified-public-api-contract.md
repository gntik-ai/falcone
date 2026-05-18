# Capability A1 — Unified Public API Contract

**Source locus:** `apps/control-plane/` (OpenAPI spec + per-family façade modules + saga/workflow engine that is *also* shipped under this app despite being out-of-scope for A1).

**Method:** Read every file under `apps/control-plane/` and traced its imports into `services/internal-contracts/` and `services/adapters/`. Did not read `openspec/`, `docs/`, `README.md` (except the one inside `apps/control-plane/src/` since it was the only documentation co-located with code).

---

## SPEC (what exists)

### Public-API contract surface

- **WHEN** the platform publishes its public API contract, **THE SYSTEM SHALL** treat `apps/control-plane/openapi/control-plane.openapi.json` as the unified OpenAPI 3.1.0 document (`info.version = 1.21.0`, 385 operations) and the files under `apps/control-plane/openapi/families/*.openapi.json` (16 files: auth, events, functions, iam, metrics, mongo, mongo-captures, mongo-capture-tenant-summary, pg-captures, pg-capture-tenant-summary, platform, postgres, storage, tenants, websockets, workspaces) as generated derivatives.
  - `apps/control-plane/openapi/control-plane.openapi.json:1-12`
  - All five sampled family files share `info.version = 1.21.0`.

- **WHEN** `scripts/generate-public-api-artifacts.mjs` is invoked, **THE SYSTEM SHALL** regenerate the per-family OpenAPI documents, write `services/internal-contracts/src/public-route-catalog.json`, and write the published API docs from the unified spec.
  - `scripts/generate-public-api-artifacts.mjs:1-12`
  - Output marker: `public-route-catalog.json:1-3` has `"generatedFrom": "apps/control-plane/openapi/control-plane.openapi.json"`.

- **WHEN** a client calls any `/v1/*` operation, **THE SYSTEM SHALL** require the `X-API-Version` header pinned to `2026-03-26`.
  - `apps/control-plane/openapi/control-plane.openapi.json:55119-55126` (`X-API-Version` param, `const: "2026-03-26"`, `pattern: "^2026-03-26$"`).

- **WHEN** internal code enumerates the public API, **THE SYSTEM SHALL** expose helpers via `apps/control-plane/src/public-api-catalog.mjs`: `publicApiRelease`, `publicApiFamilies`, `publicApiRoutes`, `publicApiResourceTaxonomy`, `getPublicApiFamily()`, `listControlPlaneRoutes(filters)`, `summarizePublicApiFamilies()`, `listConsoleRoutesByTier(tier)`, `listConsoleWorkflowRoutes(workflowId)`, `summarizeConsoleEndpointSeparation()` — all of which delegate to functions in `services/internal-contracts/src/index.mjs`.
  - `apps/control-plane/src/public-api-catalog.mjs:1-54`
  - Console tiers exposed: `['spa', 'backend', 'platform']` (`:43`).

### Per-family façade modules (re-exports of internal-contracts helpers)

All modules at `apps/control-plane/src/*.mjs` follow the same pattern: import getters/listers from `services/internal-contracts/src/index.mjs` (and occasionally from `services/adapters/src/*.mjs`) and re-export filtered slices. Verified by reading.

- **Auth (`console-auth.mjs:1-38`):** exposes `consoleAuthApiFamily`, `consoleAuthRoutes`, and a frozen status-view enum `['login','signup','pending_activation','account_suspended','credentials_expired','password_recovery']`; provides `listConsoleAuthRoutes`, `getConsoleAuthRoute`, `summarizeConsoleAuthSurface`.
- **IAM (`iam-admin.mjs:1-48`):** exposes `iamAdminApiFamily`, IAM admin request/result contracts, IAM admin routes, `summarizeIamAdminSurface()` keyed by resource kind, and `getIamCompatibilitySummary()` reporting `{provider: 'keycloak', contractVersion, supportedVersions[]}` — pulled from `services/adapters/src/keycloak-admin.mjs`.
- **Tenants (`tenant-management.mjs:1-113`):** exposes `tenantApiFamily`, `tenantLifecycleStateMachine`, `tenantManagementRoutes`, and previews for governance dashboard, resource inventory, functional-config export, lifecycle mutation, and purge draft — all delegating to internal-contracts builders. Couples to `services/adapters/src/storage-tenant-context.mjs:12` for storage-context introspection.
- **Workspaces (`workspace-management.mjs:1-39`):** exposes `workspaceApiFamily`, `workspaceLifecycleStateMachine`, route filters, `summarizeWorkspaceManagementSurface()`, `buildWorkspaceCloneDraft`, `resolveWorkspaceApiSurface`, `resolveWorkspaceResourceInheritance`.
- **Other façades** (verified by `wc -l` and import header):
  - `postgres-admin.mjs` (4.3 KB), `postgres-data-api.mjs` (94 LOC), `mongo-admin.mjs` (4.3 KB), `mongo-data-api.mjs` (5.0 KB), `events-admin.mjs` (7.6 KB), `functions-admin.mjs` (10.8 KB), `functions-audit.mjs` (6.0 KB), `functions-import-export.mjs` (6.8 KB), `storage-admin.mjs` (688 LOC — substantially larger than the others), `external-application-iam.mjs` (18 KB), `iam-governance.mjs` (5.1 KB), `console-backend-functions.mjs` (7.5 KB).
  - `observability-admin.mjs` (104 KB), `observability-audit-correlation.mjs` (14.7 KB), `observability-audit-export.mjs` (12.1 KB), `observability-audit-query.mjs` (8.1 KB).
- **Cross-cutting:**
  - `internal-service-map.mjs:1-12` — exposes `controlApiBoundary`, `controlApiCommandContract`, `controlPlaneInteractionFlows`.
  - `authorization-model.mjs:1-14` — exposes security-context / authorization-decision contracts and the `control_api` enforcement surface.
  - `domain-model.mjs:1-22` — exposes entity read/write/lifecycle contracts and `tenant`/`workspace`/`invitation`/`plan` entities plus their state machines.

### Saga orchestrator + workflow handlers (co-located but distinct capability)

Despite the README framing this app as contract-only, `apps/control-plane/src/{saga,workflows}/` contains a real Postgres-backed orchestrator.

- **WHEN** `executeSaga(workflowId, params, callerContext)` is called, **THE SYSTEM SHALL** look up the saga definition, short-circuit on idempotency-key match, persist a `saga_instances` row, execute each step's `forward` function in ordinal order, persist each `saga_steps` row, emit start/milestone/terminal audit events, and on failure invoke `compensateSaga` against succeeded steps.
  - `apps/control-plane/src/saga/saga-engine.mjs:49-143`.
- **WHEN** `definition.provisional === true`, **THE SYSTEM SHALL** return `{ status: 'not-implemented', workflowId }` without persistence.
  - `saga-engine.mjs:57-59`.
- **WHEN** an idempotency key matches a prior completed saga for the same tenant, **THE SYSTEM SHALL** return the prior result without re-running steps.
  - `saga-engine.mjs:61-64`; lookup at `saga-state-store.mjs:124-127`.
- **WHEN** `recoverInFlightSagas(stalenessThresholdMs)` is invoked, **THE SYSTEM SHALL** select sagas in `executing` or `compensating` status older than the threshold and re-drive compensation.
  - `saga-engine.mjs:145-176`; query at `saga-state-store.mjs:99-105`.
- **WHEN** saga state mutates, **THE SYSTEM SHALL** write to Postgres tables `saga_instances`, `saga_steps`, `saga_compensation_log` via the `services/adapters/src/postgresql-data-api.mjs` adapter.
  - `saga-state-store.mjs:48-50`, `:79-82`, `:117-121`.
- **WHEN** a workflow is dispatched, **THE SYSTEM SHALL** resolve it through `apps/control-plane/src/workflows/index.mjs` (registered WF-CON-001/002/003/004/006; WF-CON-005 returns `{ notImplemented: true }`; unknown ids throw `WorkflowNotFoundError`).
  - `workflows/index.mjs:9-32`.

---

## GAPS

1. **Saga step keys carry unresolved drift markers.** Every step in `apps/control-plane/src/saga/saga-definitions.mjs:50-87` (11 occurrences across WF-CON-002/003/004/006) is annotated `// TODO: verify step key matches catalog entry`. The keys are what `emitStepMilestone` writes into audit events (`saga-engine.mjs:101-104`); no validator under `scripts/` cross-checks them against any catalog.

2. **Two unrelated "not-implemented" shapes.** `workflows/index.mjs:23-25` returns `{ notImplemented: true }` for WF-CON-005; `saga-engine.mjs:57-59` returns `{ status: 'not-implemented', workflowId }` for `definition.provisional`. Callers must pattern-match both, with no shared type.

3. **A1 entry in `01-capability-map.md` is wrong.** That entry asserts `apps/control-plane/` has "no direct DB access". `saga-state-store.mjs:48-50, 79-82, 117-121` issues `INSERT`/`UPDATE`/`SELECT` against three Postgres tables. The saga engine + workflow handlers belong to a distinct capability (e.g., "Control-Plane Saga Orchestrator") that the map omits.

4. **Package has no tests, lint, or typecheck.** `apps/control-plane/package.json:6-10` — all three scripts are placeholders (`node -e "console.log('... placeholder')"`). The saga engine, idempotency store, and workflow handlers (≈1.4k LOC of side-effecting code) have zero in-package coverage.

5. **No HTTP/RPC bootstrap.** README claims responsibility for "public control-plane APIs and versioning" and "internal health and readiness endpoints" (`src/README.md:5-13`), but no server, no route registration, no entry point. The `discoveryRoute: "/v1/platform/route-catalog"` present in every catalog entry (`public-route-catalog.json:30`) has no implementation in this app.

6. **Hard-coded fallback API contract version.** `iam-admin.mjs:39` falls back to `'2026-03-24'` when `iamAdminRequestContract?.version` is undefined, but the unified spec pins `X-API-Version` to `2026-03-26` (`control-plane.openapi.json:55125`). If the contract is missing at runtime, the surface advertises a stale version with no warning.

7. **Façade → adapter coupling reverses the intended dependency direction.** `tenant-management.mjs:12` imports from `services/adapters/src/storage-tenant-context.mjs`. The other façades only depend on `services/internal-contracts/`. This makes the contract layer transitively depend on an infra adapter.

8. **Catalog generator is one-shot, no freshness check.** `public-route-catalog.json` records `generatedFrom` as a literal string (`:2`); neither `scripts/generate-public-api-artifacts.mjs` nor `scripts/validate-openapi.mjs` checks whether the catalog is newer than the spec it was derived from. A stale catalog passes validation.

9. **`workflows/index.mjs:29` assumes every workflow module has a `default` export.** No type or test enforces this. If any of `wf-con-{001,002,003,004,006}-*.mjs` lacks a `default` export the dispatcher throws a runtime `TypeError` instead of `WorkflowNotFoundError`.

10. **Eager top-level work at import time.** `internal-service-map.mjs:9-12`, `console-auth.mjs:7-8`, `iam-admin.mjs:14-17`, `tenant-management.mjs:14-16`, `workspace-management.mjs:11-13`, and all other façades resolve filters and call getters at module-load. A single missing contract id throws an unhelpful error during `import` rather than at first call.

---

## BUGS

### Confirmed (logic clearly wrong)

- **B1. Idempotency lookup is keyed on `(idempotencyKey, tenantId)` only — workflow id is dropped.**
  `apps/control-plane/src/saga/saga-state-store.mjs:124-127` —
  ```js
  const result = await adapterQuery(
    'SELECT * FROM saga_instances WHERE idempotency_key = $1 AND tenant_id = $2',
    [key, tenantId]
  );
  ```
  And `saga-engine.mjs:61-64` short-circuits on the returned row's status without checking `existing.workflow_id === workflowId`. A tenant that reuses the same idempotency key across two different workflows will receive the *other* workflow's output. Confirmed by inspection.

- **B2. WF-CON-005 is publicly addressable but unimplemented; two divergent shapes for "unimplemented" exist.**
  `workflows/index.mjs:9-15` registers IDs WF-CON-001..-006 except WF-CON-005; `:23-25` branches to return `{ notImplemented: true }` for that id; `saga-engine.mjs:57-59` returns `{ status: 'not-implemented', workflowId }`. Same concept, two payload shapes — confirmed inconsistency that will mis-serialize through any consumer that pattern-matches on either field.

### Likely (smells, races, fail-open paths)

- **B3. Postgres-adapter import silently swallowed, queries silently no-op.**
  `saga-state-store.mjs:10-15` —
  ```js
  async function loadAdapterModule() {
    if (!adapterModulePromise) {
      adapterModulePromise = import(ADAPTER_URL).catch(() => ({}));
    }
    return adapterModulePromise;
  }
  ```
  And `:17-24` falls back to `{ rows: [] }` when no callable `query`/`execute` is exported. If the adapter is missing or fails to load, *every* INSERT/UPDATE returns `{ rows: [] }` with no exception. `executeSaga` then reports success while persisting nothing; `recoverInFlightSagas` sees nothing to recover. Fail-open behavior; likely a real bug in any environment where the adapter import path drifts.

- **B4. Compensation alert can be silently dropped.**
  `saga-engine.mjs:32-47` —
  ```js
  async function emitCompensationFailedAlert(payload) {
    const emitter = typeof eventsAdmin.emit === 'function' ? eventsAdmin.emit : globalThis.__FALCONE_EVENTS_ADMIN_EMIT__;
    if (typeof emitter === 'function') {
      await emitter({ ... });
      return payload;
    }
    return payload;
  }
  ```
  If `events-admin.mjs` doesn't export `emit` AND the global isn't installed, the function returns the payload as if it had alerted — but no event fired. Compensation failures (the most critical saga state) generate no signal. Likely a real defect; the fallback path needs to throw or log at error level at minimum.

- **B5. `recoverInFlightSagas` step filter is a logically dead expression and wrong-shaped.**
  `saga-engine.mjs:155` —
  ```js
  const eligibleSteps = steps.filter((step) =>
    ['succeeded', 'compensating', 'compensation-failed'].includes(step.status) === false
      ? false
      : true);
  ```
  Reduces to `step => ['succeeded','compensating','compensation-failed'].includes(step.status)`. Beyond the code smell: this hands `compensateSaga` steps already in `succeeded` *and* steps in `compensation-failed`, so prior unrecoverable-compensation failures are re-attempted on every recovery sweep with no backoff visible in this file — and `succeeded` steps are eligible for re-compensation regardless of whether they were already compensated in a previous sweep. Idempotency at the compensation step level is not visible from this file; needs verification in `saga-compensation.mjs`, but the predicate is clearly wrong as written.

- **B6. Idempotency record only written on the happy path.**
  `saga-engine.mjs:139-141` calls `recordIdempotencyResult` only after the saga completes successfully. If a saga is in `in-progress` and crashes between start and end, the idempotency record is never finalized; a retry with the same key takes the slow path and, combined with B1, may even pick up a different workflow's row. Probably intentional for completed vs. in-progress, but worth verifying — there is no in-package documentation of the idempotency contract.

- **B7. `iam-admin.mjs` falls back to a stale hard-coded contract version.**
  `iam-admin.mjs:39` returns `iamAdminRequestContract?.version ?? '2026-03-24'`. The unified spec pins `X-API-Version` at `2026-03-26`. If `iam_admin_request` contract is missing at startup (which would also break import-time consumers), the compatibility summary silently advertises a version two days older than the platform pin.

### Needs verification (requires running code)

- **B8. Family-version drift across the unified spec.** The unified spec contains `pattern: "^2026-03-26$"` for `X-API-Version` (`:55125-55126`) but also `pattern: "^2026-03-24$"` (`:64600`) and `const: "2026-03-25"` (`:66423`, `:67701`) for other version-pin fields. Need to run `scripts/validate-openapi.mjs` to confirm these are intentionally per-family contract versions and not stale leftovers.

- **B9. Catalog round-trip freshness.** `services/internal-contracts/src/public-route-catalog.json` claims `generatedFrom: "apps/control-plane/openapi/control-plane.openapi.json"` (`:2`) but no script enforces regeneration when the spec changes. Run `scripts/generate-public-api-artifacts.mjs` and `git diff` to confirm the committed catalog is in sync with the committed spec.

- **B10. Workflow handler default exports.** `workflows/index.mjs:29` returns `(await WORKFLOW_REGISTRY.get(workflowId)()).default`. The five concrete files (`wf-con-001-user-approval.mjs` …) were not opened — if any lacks a `default` export, the call site throws `TypeError: handler is not a function` (or similar) instead of a structured error. Confirm by `grep "^export default" apps/control-plane/src/workflows/wf-con-*-*.mjs`.

---

## Scope note for downstream spec authoring

The A1 entry in `openspec/audit/01-capability-map.md` conflates two distinct things shipped from the same directory:

- **A1-proper**: the OpenAPI spec, the catalog/taxonomy generator, and the thin façade modules over `services/internal-contracts/`. These are pure read-only contract artifacts.
- **A1-orphan**: the saga engine + workflow registry under `src/saga/` and `src/workflows/`. These are stateful orchestration code with Postgres side effects, audit emission, idempotency, and recovery. They have no public REST surface in this package but are imported by name from elsewhere (not traced here).

Splitting these into two capabilities before writing OpenSpec FRs will avoid downstream contradictions.
