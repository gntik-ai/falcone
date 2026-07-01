# web-console Specification (delta)

## MODIFIED Requirements

### Requirement: Metrics time-range control has an observable effect

The system SHALL make active time-range controls affect the metrics rendered on the Observability
page, or SHALL disable/hide/label them where windowing does not apply, so that an interactive
time-range control never silently refetches identical data with no visible change. For workspace
metric series, the active console selector SHALL offer only supported preset windows (`24h`, `7d`,
and `30d`) until a custom range API exists.

#### Scenario: Tenant-scope metrics window

- **WHEN** a superadmin changes the time range on tenant-scoped Metrics
- **THEN** the rendered metrics change to reflect the window, or the control is clearly
  non-applicable at that scope (disabled/hidden/labeled)
- **AND THEN** it does not silently refetch identical data with no visible change

#### Scenario: Workspace metrics preset windows

- **WHEN** a superadmin views workspace-scoped Metrics
- **THEN** the active time-range selector offers the supported preset windows (`24h`, `7d`, and
  `30d`)
- **AND THEN** unsupported custom from/to ranges are not selectable as active controls
