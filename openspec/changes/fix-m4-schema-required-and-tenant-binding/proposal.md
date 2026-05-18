## Why

The metrics OpenAPI carries three schema-level defects that produce
either ambiguous responses or inconsistent multi-tenant validation
signalling. From `openspec/audit/cap-m4-observability-metrics.md`:

- **B3** (`apps/control-plane/openapi/families/metrics.openapi.json:1277,
  :1297-1303`) — `MetricSeriesResponse.unit` is declared with constraints
  but omitted from the `required` array. The unit field is essential for
  interpreting the series (`seconds`? `bytes`? `count`?) but clients must
  treat it as absent-possible, contradicting the field's intent.
- **B4** (`metrics.openapi.json:2079`) — `WorkspaceEventDashboardResponse`
  carries `workspaceId, window, sampledAt, widgets, coverage` but lacks
  `tenantId`. Every sibling workspace response
  (`GatewayStreamMetricsResponse:1132`, `KafkaTopicMetricsResponse:1213`)
  includes both ids. The asymmetry forces a client to issue a separate
  workspace-lookup call to learn the tenant.
- **B5** (`metrics.openapi.json:3749, :3878, :4006`) — three workspace
  observability routes (`getWorkspaceEventDashboards`,
  `getWorkspaceGatewayStreamMetrics`, `getWorkspaceKafkaTopicMetrics`)
  lack the `x-tenant-binding: required` extension that the sibling
  quota/audit routes carry. The gateway's multi-tenant guard skips these
  three routes; tenant context is enforced only by the handler, not by
  the gateway envelope.
- **G-S1.2/G-S1.3/G-S1.4/G-S1.7** — schema-asymmetry gaps that converge
  on the same fixes.

## What Changes

- Add `unit` to the `required` array of `MetricSeriesResponse` so every
  series payload carries the unit (`seconds`, `bytes`, `count`, `ratio`,
  `bytes_per_second`, etc.). Handlers populate the unit from the
  recorder's metric registration metadata.
- Add `tenantId` to `WorkspaceEventDashboardResponse` and to every other
  workspace response schema that currently omits it, with a matching
  `required` entry. Handlers populate it from the gateway-injected
  `x-falcone-tenant-id` header (which has already been validated against
  the workspace's owning tenant).
- Add `x-tenant-binding: required` to the three workspace routes that
  lack it, so the gateway's multi-tenant guard enforces the workspace
  scope before the request reaches the handler.

## Capabilities

### Modified Capabilities

- `observability-and-audit`: requirement on `unit` as a required field
  of `MetricSeriesResponse`, on `tenantId` parity across every workspace
  response schema, and on `x-tenant-binding: required` for every
  workspace route.

## Impact

- **Affected code**:
  `apps/control-plane/openapi/families/metrics.openapi.json` (three
  schema changes and three extension additions); the merged
  `apps/control-plane/openapi/control-plane.openapi.json` regenerated;
  the handlers introduced by `complete-m4-metrics-handlers` adjusted to
  populate the new required fields.
- **Migration required**: none for runtime data; consumers parsing the
  responses must accept the additional `tenantId` field (additive — no
  break) and the now-required `unit` (additive but stricter).
- **Breaking changes**: producers that currently omit `unit` from
  `MetricSeriesResponse` will now fail schema validation; this is the
  intended behaviour and surfaces emitters that lack unit metadata.
- **Cross-cutting**: depends on `complete-m4-metrics-handlers` for the
  handler layer that populates the new fields; the schema edits stand
  alone if landed first.
