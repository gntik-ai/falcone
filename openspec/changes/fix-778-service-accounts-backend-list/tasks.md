## 1. Reproduce / encode the contract

- [x] 1.1 Confirm the root cause from the issue/source trace: the Service Accounts page reads
  browser-local known IDs and never calls the collection route.
- [x] 1.2 Add a focused web-console test for the fresh-session scenario: empty `sessionStorage` must
  still call `GET /v1/workspaces/{workspaceId}/service-accounts` and list returned items.
- [x] 1.3 Add local backend coverage for the collection route response shape consumed by the
  console.

## 2. Fix

- [x] 2.1 Update `useConsoleServiceAccounts` to use the backend collection endpoint as the list
  source of truth.
- [x] 2.2 Keep create/delete known-ID helpers for mutation compatibility without letting them gate
  the list request or empty state.
- [x] 2.3 Update the backend collection handler to return console-listable items while preserving
  legacy row fields.

## 3. Wire, docs, and OpenSpec

- [x] 3.1 Document `GET /v1/workspaces/{workspaceId}/service-accounts` in the OpenAPI source and
  regenerate public API artifacts.
- [x] 3.2 Update human docs that describe Service Accounts page/list behavior.
- [x] 3.3 Materialize this OpenSpec change under
  `openspec/changes/fix-778-service-accounts-backend-list/`.

## 4. Verify

- [x] 4.1 Run focused web-console Vitest for `console-service-accounts` and
  `ConsoleServiceAccountsPage`.
- [x] 4.2 Run local backend handler test for issue #778.
- [x] 4.3 Run OpenAPI/public API validation.
- [x] 4.4 Run OpenSpec validation if the CLI is available.
- [x] 4.5 Run `git diff --check`.
