## 1. Reproduce / encode the issue

- [x] 1.1 Parse issue #795 acceptance criteria:
  - Requirement: The system SHALL load `/v1/workspaces/{ws}/docs` as the authenticated console
    session and render base URL, auth instructions, enabled-service snippets, and custom notes.
  - Scenario: WHEN `tenant_owner` opens `/console/workspaces/{ws}/docs`, THEN the page sends an
    authenticated request, receives 200, and renders docs instead of an error.
  - Note mutations: create/edit/delete affordances are available only to authorized roles.
- [x] 1.2 Confirm the current failure:
  - the deployed runtime route table has no workspace-docs route and returns `NO_ROUTE`;
  - the console docs client sends no bearer token because the fallback token is empty;
  - the page hardcodes note controls as admin-visible.
- [x] 1.3 Add focused tests that encode the route, auth, role-gate, and current API-version
  behavior.

## 2. Implement the backend/runtime fix

- [x] 2.1 Register workspace-docs routes in the kind control-plane route table.
- [x] 2.2 Register workspace-docs routes in the deployed control-plane runtime route table.
- [x] 2.3 Ship `services/workspace-docs-service` in the control-plane executor image.
- [x] 2.4 Wire the runtime to pass the metadata database pool and a request-derived API surface into
  the existing workspace-docs action.
- [x] 2.5 Normalize action auth context for gateway/JWT callers and accept the console's current
  `X-API-Version`.
- [x] 2.6 Allow tenant owners/admins to read docs while keeping note mutations restricted to
  workspace owners/admins.
- [x] 2.7 Include the workspace-docs schema migration in the kind control-plane startup migration
  set.

## 3. Implement the web-console fix

- [x] 3.1 Replace the empty fallback token path with `requestConsoleSessionJson` for docs fetches.
- [x] 3.2 Route create/update/delete note requests through the same authenticated console session
  helper.
- [x] 3.3 Derive note-management affordances from the current session roles instead of hardcoded
  `isAdmin=true`.
- [x] 3.4 Keep the existing page/component structure and styling conventions intact.

## 4. Contract, docs, and OpenSpec

- [x] 4.1 Add workspace-docs routes and schemas to the canonical control-plane OpenAPI source.
- [x] 4.2 Regenerate public API family contracts, internal route catalog, and published public API
  docs.
- [x] 4.3 Add matching entries to the legacy gateway privilege route catalog.
- [x] 4.4 Materialize this OpenSpec change under `openspec/changes/fix-795-workspace-docs-contract/`.

## 5. Verify

- [x] 5.1 Run the focused web-console docs tests after dependency install.
- [x] 5.2 Run the workspace-docs service tests.
- [x] 5.3 Run the runtime black-box route test for `GET /v1/workspaces/{workspaceId}/docs`.
- [x] 5.4 Run public API generation and validation.
- [x] 5.5 Run OpenSpec validation for this change.
- [x] 5.6 Run `git diff --check`.
- [ ] 5.7 Deploy to the designated kind cluster and verify against discovered live URLs.
  Blocked in this run: no local kind cluster is available, and the canonical URL from the brief is
  read-only.
