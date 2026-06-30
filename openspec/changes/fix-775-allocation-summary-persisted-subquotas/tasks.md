## 1. Backend

- [x] 1.1 Replace the allocation-summary action's direct `_workspaceSubQuotas` read with
  the existing repository API that supports both in-memory and Postgres-backed rows.
- [x] 1.2 Preserve the existing self/admin route authorization checks and response shape.
- [x] 1.3 Add a regression test using a fake Postgres-style `query()` client with no
  `_workspaceSubQuotas` property so the old implementation returns an empty summary.
- [x] 1.4 Keep existing in-memory allocation arithmetic coverage and add a no-rows empty
  summary case.

## 2. Web Console

- [x] 2.1 Confirm no UI or wire-shape change is required.
- [x] 2.2 Add focused page coverage for populated table rendering versus no-allocation
  empty-state rendering.

## 3. Specs And Docs

- [x] 3.1 Add OpenSpec deltas for `quotas-plans` and `web-console`.
- [x] 3.2 Add developer-facing architecture documentation for the persisted allocation
  summary source of truth.
- [x] 3.3 Leave OpenAPI, route maps, generated SDKs, and shared response types unchanged
  because the response schema is unchanged.

## 4. Verification

- [x] 4.1 Run the focused backend allocation-summary test.
- [x] 4.2 Run the focused web-console allocation-summary page test.
- [x] 4.3 Run `openspec validate fix-775-allocation-summary-persisted-subquotas --strict`.
- [x] 4.4 Run `git diff --check`.
