## Why

The function-admin family has a cluster of silently-wrong defaults and missing
tenant-isolation evidence around route counts, plan-tier resolution, audit
isolation evidence, error classification, and the dispatcher annotation. From
`openspec/audit/cap-h1-openwhisk-function-admin-invocation.md`:

- **B8** (`apps/control-plane/src/functions-admin.mjs:135-137`) —
  `summarizeFunctionsAdminSurface` reports
  `routeCount: actionRoutes.filter((route) => route.method === 'GET').length`
  on the `action_collection` row, but this counts every GET on
  `function_action` resourceType (line 76:
  `actionRoutes = functionsAdminRoutes.filter((route) => route.resourceType
  === 'function_action')`). `GET /actions/{id}` is also a GET; the count
  conflates single-action gets with collection lists.
- **B11** (`services/adapters/src/openwhisk-admin.mjs:186-195`) —
  `derivePlanTier(planId)` returns `'starter'` for any unknown plan id,
  silently downgrading.
- **B12** (`openwhisk-admin.mjs:1328-1333`) — tenant-isolation evidence
  claims `capturesTenantIsolation: true` but does not record query scope
  on `list` actions; the audit cannot reconstruct what was queried.
- **B13** (`openwhisk-admin.mjs:1742-1750`) — error classification defaults
  to `'dependency_failure'` for any unknown OpenWhisk status; 418, 451,
  and future codes all become "dependency failure".
- **B16** (`openwhisk-admin.mjs:1794`) — `dispatchWorkflowAction` hard-codes
  `initiating_surface: 'console_backend'`; non-console callers get the
  wrong annotation.
- **G12** (`functions-admin.mjs:135-137` routeCount classification), **G16**
  (`openwhisk-admin.mjs:1742-1750` error classification default).

## What Changes

- Fix the routeCount classification at `functions-admin.mjs:135-137`:
  `action_collection` counts only routes whose path equals `'/actions'`
  (collection list), not every GET on the `function_action` resource type.
- Reject unknown plan ids at `openwhisk-admin.mjs:186-195` with
  `errorCode: 'UNKNOWN_PLAN_ID'`; no silent downgrade.
- Add a `queryScope` field to the audit-isolation evidence at
  `openwhisk-admin.mjs:1328-1333` for every `list`/`query` action so the
  audit reconstructs what was queried.
- Expand the error classification table at `openwhisk-admin.mjs:1742-1750`
  to cover the OpenWhisk-documented status codes; unknown statuses
  classify as `'unknown_status'`, not `'dependency_failure'`.
- Make `dispatchWorkflowAction` accept `initiating_surface` from its
  annotation parameter and validate it against a known set
  (`console_backend`, `function_runtime`, `external_caller`); reject
  invalid values.

## Capabilities

### Modified Capabilities

- `functions-runtime`: requirements covering route-count classification,
  plan-tier resolution strictness, tenant-isolation evidence completeness,
  error-classification taxonomy, and dispatcher annotation correctness.

## Impact

- **Affected code**:
  `apps/control-plane/src/functions-admin.mjs:135-137`,
  `services/adapters/src/openwhisk-admin.mjs:186-195, :1328-1333,
  :1742-1750, :1794`,
  `tests/adapters/openwhisk-admin.test.mjs`,
  `tests/unit/functions-admin-summary.test.mjs`.
- **Migration required**: none in schema.
- **Breaking changes**: tenants using unknown plan ids will now receive
  `UNKNOWN_PLAN_ID` instead of being silently treated as starter; callers
  of `dispatchWorkflowAction` from non-console surfaces must pass an
  explicit `initiating_surface`. Document the deprecation.
- **Out of scope**: the invocation handler itself (covered by
  `complete-h1-invocation-handler`); contract-version fallbacks (covered
  by `fix-h1-public-url-and-contract-versions`).
