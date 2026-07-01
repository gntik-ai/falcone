## 1. Scope / contract

- [x] 1.1 Confirm `triggerFlowSchedule` already exists in the web-console flows API client.
- [x] 1.2 Confirm backend route support and the public route catalog already include
  `POST /v1/flows/workspaces/{workspaceId}/flows/{flowId}/schedule/trigger`.
- [x] 1.3 Keep the wire unchanged; do not modify backend routes, API response shapes, generated
  clients, OpenAPI, or realtime event schemas.

## 2. Implementation

- [x] 2.1 Add a `/console/flows` shell navigation item.
- [x] 2.2 Add a reusable published-flow `Run now` control that confirms before calling
  `triggerFlowSchedule`.
- [x] 2.3 Wire `Run now` into `ConsoleFlowsPage` row actions and `ConsoleFlowDesignerPage` header
  actions.
- [x] 2.4 Disable `Run now` for draft/non-published flows with an accessible reason and without
  blocking draft editing.
- [x] 2.5 Navigate to `/console/flows/{flowId}/runs` with a success/next-step state after a trigger.
- [x] 2.6 Use `ConsolePageState` for affected blocked/loading/empty/error flow states where
  practical.
- [x] 2.7 Add shared flow/run status badges using console design-system tokens.

## 3. Tests

- [x] 3.1 Extend flow-list tests so a published flow trigger calls `triggerFlowSchedule` and
  navigates to `/console/flows/{flowId}/runs`.
- [x] 3.2 Extend flow-list tests so draft flows do not trigger.
- [x] 3.3 Extend designer tests so a published flow trigger calls `triggerFlowSchedule` and
  navigates to run history.
- [x] 3.4 Extend shell tests so the sidebar includes `/console/flows`.
- [x] 3.5 Extend history/page-state tests for trigger next-step, empty/error states, and run-detail
  reachability.

## 4. Docs / validation

- [x] 4.1 Update flow console documentation with run/trigger operability and page-state behavior.
- [x] 4.2 Run focused web-console tests.
- [x] 4.3 Run `openspec validate fix-793-flows-console-operability --strict`.
- [x] 4.4 Run public API generation/no-diff validation or explain why no contract generation was
  needed.
- [x] 4.5 Run `git diff --check`.
