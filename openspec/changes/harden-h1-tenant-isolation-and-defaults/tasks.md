## 1. Failing tests

- [ ] 1.1 [test] Add a case in `tests/unit/functions-admin-summary.test.mjs`
      asserting `summarizeFunctionsAdminSurface().actionCollection.routeCount`
      equals exactly one (only `GET /actions`) and not the count of every
      GET on `function_action` resources (proves B8 at
      `apps/control-plane/src/functions-admin.mjs:135-137`).
- [ ] 1.2 [test] Add cases in `tests/adapters/openwhisk-admin.test.mjs`
      asserting (a) `derivePlanTier('unknown_plan')` throws
      `UNKNOWN_PLAN_ID` (proves B11 at
      `services/adapters/src/openwhisk-admin.mjs:186-195`),
      (b) a list-action audit summary records `queryScope: {tenantId,
      workspaceId, filters}` (proves B12 at `:1328-1333`),
      (c) an OpenWhisk 418 classifies as `'unknown_status'`, not
      `'dependency_failure'` (proves B13 at `:1742-1750`).
- [ ] 1.3 [test] Add a case asserting `dispatchWorkflowAction` accepts
      `annotation.initiating_surface: 'function_runtime'` and stamps it
      verbatim; asserts an unknown surface throws
      `INVALID_INITIATING_SURFACE` (proves B16 at `:1794`).

## 2. Implementation

- [ ] 2.1 [fix] Change `functions-admin.mjs:135-137` to count only routes
      whose path equals `'/actions'` (the collection list). Add an
      `actionDetail.routeCount` field for `'/actions/{id}'` so the
      conflation is resolved.
- [ ] 2.2 [fix] Make `derivePlanTier` at `openwhisk-admin.mjs:186-195`
      throw `UNKNOWN_PLAN_ID` instead of returning `'starter'` for
      unrecognised ids.
- [ ] 2.3 [fix] At `openwhisk-admin.mjs:1328-1333`, populate
      `tenantIsolationEvidence.queryScope = {tenantId, workspaceId,
      filters}` for every `list`/`query` action so the audit reconstructs
      what was queried.
- [ ] 2.4 [fix] Expand the error classification table at
      `openwhisk-admin.mjs:1742-1750` with explicit entries for OpenWhisk
      status codes; default unknown statuses to
      `'unknown_status'` instead of `'dependency_failure'`.
- [ ] 2.5 [fix] At `openwhisk-admin.mjs:1794`, source
      `initiating_surface` from the `annotation` parameter and validate it
      against `{console_backend, function_runtime, external_caller}`;
      throw `INVALID_INITIATING_SURFACE` for any other value.

## 3. Validation

- [ ] 3.1 [spec] Land the spec delta under `specs/functions-runtime/spec.md`.
- [ ] 3.2 [docs] Document the new route-count fields, strict plan-tier
      resolution, expanded tenant-isolation evidence, error classification
      taxonomy, and dispatcher annotation in the `functions-admin` README.
- [ ] 3.3 [test] Run `corepack pnpm test:unit -- 'functions-admin|openwhisk-admin'`
      and `openspec validate harden-h1-tenant-isolation-and-defaults --strict`;
      both green before merge.
