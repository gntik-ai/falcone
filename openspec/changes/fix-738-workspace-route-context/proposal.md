# Change: fix-738-workspace-route-context

## Why

Issue #738 is a confirmed web-console context restoration bug.

`/console/workspaces/{workspaceId}` is a valid workspace-scoped route, but the console shell restored
active context only from persisted local selection or from a single available tenant/workspace option.
When a tenant owner with access to multiple workspaces opened a workspace URL directly in a fresh
session, the route `workspaceId` was ignored and the shell kept `activeWorkspaceId` unset. The header
then showed `Sin workspace seleccionado`, and workspace-scoped screens rendered no-workspace empty
states or failed to load their normal context.

The issue acceptance criteria are:

- Requirement: The system SHALL derive the active workspace from the `workspaceId` route param when
  present, so deep-linking/refreshing a workspace-scoped URL restores full context for that
  workspace, subject to the user's access.
- Scenario: WHEN a tenant owner opens `/console/workspaces/{id}` or refreshes/deep-links to a
  workspace-scoped page directly in a fresh session, THEN the header shows that workspace as active
  and the page loads data, not `Sin workspace seleccionado` / no-workspace empty state.

## What Changes

- Pass the matched `workspaceId` route parameter from the console shell route branch into
  `ConsoleContextProvider`.
- When a route workspace id is present, resolve it through the existing accessible tenant and
  workspace APIs before selecting or persisting it.
- If the route workspace belongs to another accessible tenant, select that tenant first and then the
  route workspace.
- If the route workspace is not accessible to the current session, keep `activeWorkspaceId` unset and
  do not fall back to an unrelated persisted or auto-selected workspace.
- Add shell/provider regression tests for fresh deep-link restoration and inaccessible route
  workspace behavior.
- Add a short architecture reference note for console workspace deep-link context behavior.

## Impact

- Frontend:
  - `ConsoleShellLayout` forwards matched route workspace params.
  - `ConsoleContextProvider` validates route workspaces against accessible workspace options and
    derives active tenant/workspace context from the route.
- Backend/wire:
  - No backend, OpenAPI, generated SDK, or shared wire type changes are required. The fix uses the
    existing tenant and workspace list APIs already consumed by the console.
- Docs/OpenSpec:
  - Adds this OpenSpec delta and a human-readable reference note.

## Non-Goals

- No changes to workspace dashboard data fetching or consumption response schemas.
- No new API routes or authorization rules.
- No cluster deployment or mutation in this isolated implementation run.
