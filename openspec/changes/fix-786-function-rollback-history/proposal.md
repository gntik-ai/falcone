## Why

Function rollback was advertised but not implemented in the kind control-plane. The active function
row in `fn_actions` carried only the current source and a numeric `version` counter. Deploy/update
overwrote the source while incrementing that counter, `GET /versions` returned only the active
`vN` row with `rollbackEligible:false`, and `POST /rollback` returned `202` without mutating state.

That left the backend and console inconsistent: detail could report `rollbackAvailable: true` from
`version > 1`, while the Versions tab had no retained prior version to select and the Rollback button
was disabled. Even when a rollback request was sent, the active source and active version never
changed.

## What Changes

- Add durable, additive function action history in the kind control-plane:
  - `fn_action_versions` stores immutable deploy snapshots with `fnv_[0-9a-z]+` version IDs,
    tenant/workspace scope, source, execution fields, version number, status, origin, and timestamps.
  - `upsertFnAction` snapshots every successful create/update and marks the new snapshot active.
  - The first post-upgrade update of an existing no-history action retains the current active
    `fn_actions` row before overwriting it, so that update immediately has a rollback target.
  - legacy `fn_actions` rows without retained snapshots still produce one synthetic active version
    response, but do not claim rollback availability.
- Make function detail and versions derive rollback state from retained history, not from the
  numeric `fn_actions.version` counter alone.
- Make rollback validate the target version belongs to the same function and tenant/workspace, reject
  missing/current/ineligible targets, redeploy the selected retained source through the existing
  Knative deploy helper when a service name exists, and update `fn_actions` to the selected snapshot.
- Add deterministic black-box backend coverage for create/update history, rollback state mutation,
  retained history after rollback, and legacy no-history behavior.
- Add focused web-console Vitest coverage that when detail says rollback is available, the Versions
  tab lists a prior eligible version and the Rollback button is enabled.
- Document the storage model and API/console consistency contract under
  `docs/reference/architecture/function-rollback-history.md`.

## Impact

- Affected capability: `functions`.
- Backend/frontend wire shape stays additive and contract-compatible: existing function action routes
  are unchanged; version IDs now match the published `fnv_[0-9a-z]+` pattern and version responses
  include the required retained-history fields.
- Rollback remains tenant-scoped through `getFnAction(..., callerTenantId(...))` and the retained
  version must match the resolved action's tenant and workspace.
- No Kubernetes or hosted environment mutation is required for tests; Knative redeploy is exercised
  through an injected helper in unit/black-box tests and the real helper in runtime.

## Non-Goals

- This change does not introduce a new public route or alter OpenAPI route definitions.
- This change does not backfill historical source snapshots for deployments that predate
  `fn_action_versions`; those rows are represented as active-only legacy rows until redeployed.
