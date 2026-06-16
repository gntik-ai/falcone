Tracking issue: gntik-ai/falcone#500

## Why

The live runtime implements only a fraction of the 392-route OpenAPI catalog. Probes return `NO_ROUTE` for storage object I/O, function secrets/triggers/rules, tenant memberships/invitations/custom-roles, the tenant dashboard, mongo aggregation/admin, and several metrics dashboards. This is a REST↔spec and REST↔console completeness gap: advertised routes do not exist at runtime.

(Evidence: route probes across `tests/live-audit/evidence/05-storage-s3.md`, `06-functions-events.md`, `09-auth-and-governance.md`, `10-rbac-keys-secrets.md`, `13-metrics.md`.)

## What Changes

- For each advertised-but-unwired route, either wire the intended handler or remove it from the published OpenAPI catalog, so the public surface matches reality.

## Capabilities

### New Capabilities

### Modified Capabilities

- `gateway`: Every advertised public route either responds at runtime or is removed from the published catalog, eliminating `NO_ROUTE` for advertised endpoints.

## Impact

- Published OpenAPI catalog and the routes table.
- Handlers for storage object I/O, function secrets/triggers/rules, tenant memberships/invitations/custom-roles, tenant dashboard, mongo aggregation/admin, metrics dashboards.
