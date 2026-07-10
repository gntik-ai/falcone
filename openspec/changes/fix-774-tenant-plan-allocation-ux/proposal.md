## Why

The tenant-facing plan pages (`/console/my-plan` and
`/console/my-plan/allocation`) are the primary surface a tenant owner uses to
understand current plan limits, quota consumption, and per-workspace allocation.
Issue #774 confirmed that the allocation page drops its header in loading,
error, and empty states, the empty treatment has no icon, allocation breakdowns
show raw workspace identifiers without units, and the "My Plan" aggregate
over-limit banner uses warning styling for a destructive quota breach.

The backend allocation-summary and effective-entitlements contracts already
return the quota dimensions and usage state needed by the console. This change
keeps the wire contract unchanged and fixes the tenant-facing console rendering
so every state remains navigable, quota breaches are visually honest, and
allocation rows are legible.

## What Changes

- Render the allocation summary page shell/header before every loading, error,
  tenant-less, empty, and populated state, including a link back to `Mi plan`.
- Extend `ConsolePageState` with an optional icon slot while preserving all
  existing call sites.
- Use the icon slot from the allocation page states, including the common empty
  state for tenants with no workspace sub-quota allocations.
- Render allocation values with the dimension unit and use human-readable
  workspace labels when provided by the response. If only a UUID-like workspace
  id is available, the page uses an ordinal workspace label rather than making
  the raw UUID the primary copy.
- Rework the allocation table to use the shared table primitive and row/header
  semantics.
- Render the tenant plan aggregate over-limit banner with destructive styling
  and `alert` semantics instead of amber warning styling.
- Update focused web-console tests and the local allocation-summary reference
  note.

## Non-Goals

- No backend, OpenAPI, gateway, SDK, or generated contract change. The console
  still consumes the existing allocation-summary and effective-entitlements
  endpoints.
- No new breadcrumb/navigation framework. The allocation page uses the existing
  route/link conventions and keeps the change local.
- No live cluster deployment or browser check in this run; the delegated task
  explicitly safety-blocks Kubernetes mutation/deploy on the active context.

## Exit Criteria

- Focused web-console tests cover the header-first allocation states, iconized
  empty state, allocation value units/workspace labels, and destructive
  over-limit aggregate banner.
- `openspec validate fix-774-tenant-plan-allocation-ux --strict` passes.
- The working diff is limited to scoped frontend, docs, tests, and OpenSpec
  files for issue #774.

## Risks and Rollback

The change is UI-only and additive. The optional workspace label fields are read
defensively and do not require the backend to emit them. Rollback is a straight
revert of the frontend rendering/tests/docs/OpenSpec files in this change.
