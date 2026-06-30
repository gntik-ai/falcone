# Function Rollback History

The kind control-plane stores the current executable function action in `fn_actions` and stores
immutable deploy snapshots in `fn_action_versions`. The active row remains backward-compatible for
existing callers: `fn_actions` still contains the current source, runtime, entrypoint, limits, and
Knative service name. Version history is additive and is used only for version listing and rollback.

## Storage Model

| Table | Purpose |
| --- | --- |
| `fn_actions` | Current executable function action. The `version` column is a monotonic deploy counter used when creating the next snapshot. Rollback does not decrement it. |
| `fn_action_versions` | Durable deploy snapshots keyed by `version_id` (`fnv_[0-9a-z]+`) with `resource_id`, tenant/workspace scope, `version_number`, source, runtime, entrypoint, parameters, limits, status, origin, and timestamps. |

Every successful create or update through `POST /v1/functions/actions` or
`PATCH /v1/functions/actions/{resourceId}` writes a snapshot to `fn_action_versions` and marks it
`active`. Existing active snapshots for the same `resource_id` are retained as `historical`.

Rows created before this history table existed are handled as legacy active rows. The API can still
return a synthetic active version row for display, but rollback is not available until a real retained
prior snapshot exists.

## API Behavior

`GET /v1/functions/actions/{resourceId}` derives:

- `activeVersionId` from the active retained snapshot, or from a synthetic legacy active version when
  no history exists.
- `versionCount` from retained snapshots, or `1` for a legacy active-only row.
- `rollbackAvailable` from actual retained prior versions only. A numeric `fn_actions.version > 1`
  is not sufficient.

`GET /v1/functions/actions/{resourceId}/versions` returns retained snapshots newest first. Each item
uses a contract-shaped `versionId` (`fnv_[0-9a-z]+`), includes the tenant/workspace scope, source,
execution configuration, activation policy, timestamps, and marks `rollbackEligible: true` only for
retained versions whose `version_number` is lower than the active version number.

`POST /v1/functions/actions/{resourceId}/rollback` requires a retained, same-function,
same-tenant/workspace `versionId`. The handler rejects:

- missing or malformed `versionId` with `400 VALIDATION_ERROR`;
- unknown or non-retained versions with `404 VERSION_NOT_FOUND`;
- the current active version, or any non-prior retained version, with `409 VERSION_NOT_ELIGIBLE`.

When rollback is accepted, the control-plane redeploys the selected snapshot to the existing Knative
service when that service is known, then updates `fn_actions` to the selected snapshot and marks that
snapshot `active`. Retained history stays visible after rollback. Because `fn_actions.version` remains
monotonic, the next deploy creates the next new version number rather than overwriting an older
snapshot.

## Console Consistency

The web console's Functions page reads detail and versions through the same API surface:

- the Detail tab should show `rollbackAvailable: true` only when the Versions tab can list at least
  one prior retained version with `rollbackEligible: true`;
- the Versions tab selects the first eligible prior version and enables the Rollback button;
- after rollback, the console reloads detail and versions so the active version and retained history
  reflect the backend state.
