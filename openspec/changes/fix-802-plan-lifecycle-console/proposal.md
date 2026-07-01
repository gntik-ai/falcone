## Why

The superadmin plan-management console could create a plan and edit its limits, but it did
not expose the existing plan lifecycle transition API and had no safe plan removal path.
Plans created from `/console/plans` were therefore operationally stuck in `draft` unless an
operator bypassed the console, and obsolete test plans accumulated with no console removal
flow.

The backend already modeled forward lifecycle transitions (`draft -> active -> deprecated
-> archived`), but the console did not call them. The backend also lacked a bare
`DELETE /v1/plans/{planId}` action; deleting a plan must be safe because plan assignments
and audit records are part of the plan history.

## What Changes

- `services/provisioning-orchestrator`
  - Adds `plan-delete.mjs` and repository support for safe deletion.
  - Allows hard delete only for never-assigned plans.
  - Refuses deletion when active or historical tenant assignments exist, returning
    `PLAN_HAS_ASSIGNMENT_HISTORY` so operators retire the plan through archive instead.
  - Preserves audit rows by detaching their `plan_id`, inserts a `plan.deleted` audit row,
    and emits a `console.plan.deleted` event.
- Route/wire artifacts
  - Adds `DELETE /v1/plans/{planId}` to the plan gateway routes, kind control-plane seed
    routes, runtime route map, discovery route map, and test action-runner routes.
- `apps/web-console`
  - Adds typed lifecycle and delete functions to `planManagementApi`.
  - Adds lifecycle controls on plan detail:
    - draft plans can be activated;
    - active plans can be marked obsolete with confirmation;
    - deprecated plans can be archived with confirmation.
  - Adds a confirmed delete control that navigates back to the catalog after successful
    deletion and surfaces backend refusal through the shared destructive confirmation
    dialog.
- Tests
  - Adds backend integration coverage for safe delete, superadmin authorization, assignment
    history refusal, audit preservation, and event emission.
  - Adds frontend coverage for draft activation/status refresh and confirmed deletion.
- Docs
  - Documents the plan lifecycle/removal behavior, route semantics, and console flow.

## Capabilities

### Added Capabilities

- `web-console`: superadmins can operate the full plan lifecycle and plan removal flow from
  the plan detail page.
- `quotas-plans`: superadmins can request safe deletion of never-assigned plans through
  `DELETE /v1/plans/{planId}`; plans with assignment history must be retired by lifecycle
  archive instead of hard-deleted.
