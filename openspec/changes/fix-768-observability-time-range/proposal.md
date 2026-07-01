# Change: fix-768-observability-time-range

## Why

The Observability Metrics tab displayed an active 24h / 7d / 30d time-range selector at tenant
scope, but tenant metrics load only `/overview` and `/usage`. Those tenant endpoints do not accept a
window parameter, and `/series` is workspace-scoped, so changing the selector refetched identical
tenant data without changing the rendered metrics.

## What Changes

- Keep the time-range selector active for workspace-scoped Metrics, where the console requests
  `/v1/metrics/workspaces/{workspaceId}/series?metricKey=api_requests&window=...`.
- Offer only the workspace metric-series presets currently supported by the console contract
  (`24h`, `7d`, and `30d`); custom from/to ranges stay unavailable until a real API exists.
- Disable and label the selector at tenant-scoped Metrics so it is clearly non-applicable when no
  workspace series is rendered.
- Prevent tenant-only Metrics loads from using range changes as a reload key, avoiding identical
  `/overview` and `/usage` refetches.
- Add focused web-console tests for tenant non-applicability, workspace range changes, and hook
  request behavior.
- Document the scope boundary for metrics time ranges.

## Impact

- Frontend:
  - `ConsoleObservabilityPage` marks the selector disabled/non-applicable when no workspace is
    selected.
  - `ConsoleTimeRangeSelector` supports a disabled explanatory state and only renders supported
    metric window presets.
  - `useConsoleMetrics` ignores range changes for tenant-only metrics while preserving workspace
    `/series?window=` behavior.
- Backend/wire:
  - No backend, route catalog, OpenAPI/AsyncAPI, generated SDK, shared type, status code, error
    schema, auth-claim, pagination/filter, or realtime event change is required.
- Docs/OpenSpec:
  - Adds this OpenSpec delta and a short architecture/reference note.

## Non-Goals

- No new tenant metrics windowing API.
- No custom from/to metric range UI or API.
- No change to the existing workspace metric-series request shape.
- No cluster deployment or mutation in this isolated implementation run.
