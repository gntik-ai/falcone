# Change: fix-770-tenant-reselect-workspaces

## Why

Issue #770 is a confirmed low-severity web-console context robustness bug.

The console's tenant selector handler cleared `activeWorkspaceId`, `workspaces`,
`workspacesError`, and reset the workspace reload key even when the selected tenant was already
active. Because the workspace loader depends on `activeTenantId` and `workspaceReloadKey`, a
same-tenant selection event could empty the workspace list without triggering a new
`GET /v1/workspaces`. The shell then rendered `Sin workspaces accesibles` with no recovery
affordance unless `workspacesError` was set.

The issue acceptance criteria are:

- Requirement: the system SHALL leave the workspace selector consistent after any tenant-selection
  event, preserving the existing list when the tenant is unchanged or refetching it, and SHALL never
  leave the list permanently empty without a reload.
- Scenario 1: WHEN the tenant selector change handler runs for the tenant already active, THEN the
  workspace list is preserved or refetched and the selector is never stuck empty.
- Scenario 2: WHEN the workspace list becomes empty for any reason other than a genuine empty tenant,
  THEN a retry affordance is offered, not only on `workspacesError`.

## What Changes

- Make `ConsoleContextProvider.selectTenant` idempotent for unchanged tenant selections:
  - preserve the current workspace list and active workspace when workspaces are present;
  - refetch workspaces by incrementing `workspaceReloadKey` when the unchanged tenant has an empty
    workspace list or a workspace error.
- Render the existing `Reintentar workspaces` affordance whenever an active tenant has an empty,
  non-loading workspace list, not only when `workspacesError` is set.
- Add focused provider and shell regressions for unchanged-tenant reselection, empty-list refetch,
  and empty-list retry.
- Add a short architecture reference note for tenant/workspace context consistency.

## Impact

- Frontend:
  - `apps/web-console/src/lib/console-context.tsx` keeps same-tenant selection from clearing
    workspace state and reloads if the list is already empty.
  - `apps/web-console/src/layouts/ConsoleShellLayout.tsx` offers workspace retry for empty active
    tenant workspace lists.
- Backend/wire:
  - No backend, route catalog, OpenAPI/AsyncAPI, generated SDK, shared type, status code, error
    schema, auth-claim, pagination/filter, or realtime event change is required. The console
    continues to use the existing `GET /v1/workspaces` list endpoint.
- Docs/OpenSpec:
  - Adds this OpenSpec delta and a human-readable reference note.

## Non-Goals

- No changes to workspace authorization or workspace list response shape.
- No new API route or generated client change.
- No cluster deployment or mutation in this isolated implementation run.
