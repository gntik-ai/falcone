# Observability Metrics Time Range

The web console's Observability Metrics time-range selector is consequential only when the active
scope includes a workspace.

At tenant scope, the Metrics tab reads:

- `GET /v1/metrics/tenants/{tenantId}/overview`
- `GET /v1/metrics/tenants/{tenantId}/usage`

Those tenant routes return the current tenant quota/usage overview and do not accept a `window`
query parameter. When no workspace is selected, the console therefore labels the time-range selector
as non-applicable and disables it instead of presenting an active control that would refetch the same
tenant data.

At workspace scope, the Metrics tab also reads the window-aware series route:

```http
GET /v1/metrics/workspaces/{workspaceId}/series?metricKey=api_requests&window=7d
```

The console keeps the selector active for workspace-scoped Metrics and maps the presets to the
existing `window` values (`24h`, `7d`, and `30d`). Custom from/to metric ranges are not exposed in
the active selector until the backend provides a corresponding range-aware API. This behavior does
not change the public API or the generated SDK surface.
