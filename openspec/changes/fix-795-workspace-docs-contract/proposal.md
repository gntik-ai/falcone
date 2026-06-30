# Change: fix-795-workspace-docs-contract

## Why

Issue #795 is a confirmed console/backend contract break on the workspace documentation page.

`/console/workspaces/{workspaceId}/docs` called `GET /v1/workspaces/{workspaceId}/docs`, but the
deployed control-plane runtime did not register that route and returned
`404 {code:"NO_ROUTE"}`. The console client also passed an empty fallback token instead of the active
console session bearer token, so even a registered route would not be called as the authenticated
user. Finally, the page hardcoded note-management affordances as admin-visible, independent of the
caller roles that the backend enforces.

The issue acceptance criteria are:

- Requirement: The system SHALL load `/v1/workspaces/{ws}/docs` as the authenticated console session
  and render the base URL, auth instructions, enabled-service snippets and custom notes; note
  create/edit/delete SHALL be available only to authorized roles.
- Scenario: WHEN `tenant_owner` opens `/console/workspaces/{ws}/docs`, THEN the page sends an
  authenticated request, receives 200, and renders docs instead of an error.

## What Changes

- Register the workspace-docs routes in both the kind action-router table and the deployed
  control-plane runtime:
  - `GET /v1/workspaces/{workspaceId}/docs`
  - `POST /v1/workspaces/{workspaceId}/docs/notes`
  - `PUT /v1/workspaces/{workspaceId}/docs/notes/{noteId}`
  - `DELETE /v1/workspaces/{workspaceId}/docs/notes/{noteId}`
- Ship `services/workspace-docs-service` in the control-plane executor image, and pass the existing
  metadata database pool to the action so notes and audit rows persist through the same control-plane
  database used by the running runtime.
- Normalize gateway/JWT auth context in the workspace-docs action:
  - accept the console's current API version header (`2026-03-26`);
  - derive `actorId` from the verified subject when needed;
  - derive `workspaceId` from the path when the token is tenant-scoped;
  - allow tenant owner/admin roles to read docs while keeping note mutation restricted to
    `workspace_owner` and `workspace_admin`.
- Update the web console docs client to use `requestConsoleSessionJson` for every docs request.
  This sends the session bearer token, refreshes on 401 using the existing console session helper,
  and removes the empty fallback token path.
- Derive note controls from actual console session roles instead of `isAdmin=true`.
- Add the routes and schemas to the canonical control-plane OpenAPI contract, regenerate the
  workspaces family contract, internal public route catalog, and public API docs, and add matching
  entries to the legacy gateway privilege catalog.
- Include the workspace-docs migration in the kind control-plane startup migration set so the route
  has its notes/access-log schema in the designated test environment.

## Impact

- Backend/runtime:
  - `apps/control-plane/src/runtime/server.mjs`
  - `apps/control-plane/src/runtime/main.mjs`
  - `apps/control-plane/Dockerfile`
  - `deploy/kind/control-plane/routes.mjs`
  - `deploy/kind/control-plane/governance-schema.mjs`
  - `deploy/kind/control-plane/required-migrations.txt`
  - `services/workspace-docs-service/actions/workspace-docs.mjs`
  - `services/workspace-docs-service/migrations/087-workspace-doc-notes.sql`
- Frontend:
  - `apps/web-console/src/lib/console-workspace-docs.ts`
  - `apps/web-console/src/pages/ConsoleDocsPage.tsx`
  - `apps/web-console/src/components/console/WorkspaceDocNotes.tsx`
- Contract/docs:
  - `apps/control-plane/openapi/control-plane.openapi.json`
  - generated family/catalog/docs artifacts
  - `services/gateway-config/public-route-catalog.json`
- Tests:
  - workspace-docs action tests
  - runtime black-box route test for the issue scenario
  - web-console client/page/note tests

## Non-Goals

- No broad redesign of the workspace docs UI.
- No changes to unrelated workspace API surfaces.
- No mutation of the canonical production-like URL. The mission brief permits only read-only use
  there, and this run has no local kind cluster to deploy into.
