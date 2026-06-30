## 1. Reproduce / scope

- [x] 1.1 Confirm the registered routes already exist in `apps/web-console/src/router.tsx`.
- [x] 1.2 Confirm `ConsoleFlowHistoryPage` already links each run row to its detail route.
- [x] 1.3 Confirm `ConsoleFlowsPage` and `ConsoleFlowDesignerPage` lacked a visible run-history
  affordance.

## 2. Fix

- [x] 2.1 Add a row-level `Run history` link on the flow list.
- [x] 2.2 Add a `Run history` link in the flow designer header.
- [x] 2.3 Keep the fix frontend-only; do not change backend APIs, OpenAPI, SDKs, or realtime
  contracts.

## 3. Tests

- [x] 3.1 Add/extend a flow-list test that asserts a flow row links to
  `/console/flows/{flowId}/runs`.
- [x] 3.2 Add a flow-designer test that asserts the designer links to
  `/console/flows/{flowId}/runs`.
- [x] 3.3 Extend the run-history test so a run row's `Open` link still points to
  `/console/flows/{flowId}/runs/{executionId}`.

## 4. Docs / validation

- [x] 4.1 Add a focused docs/reference note for flow console navigation.
- [x] 4.2 Run focused web-console Vitest files.
- [x] 4.3 Run `openspec validate fix-792-flow-run-history-navigation --strict` if the CLI is
  available.
- [x] 4.4 Run public API generation/no-diff validation if practical.
- [x] 4.5 Run `git diff --check`.
