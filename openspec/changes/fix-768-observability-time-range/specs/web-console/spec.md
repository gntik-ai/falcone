# web-console Specification (delta)

## MODIFIED Requirements

### Requirement: Metrics time-range control has an observable effect

The system SHALL make the time-range selector affect the metrics rendered on the Observability
page, or SHALL disable/hide/label it where windowing does not apply, so that an interactive
time-range control never silently refetches identical data with no visible change.

#### Scenario: Tenant-scope metrics window

- **WHEN** a superadmin changes the time range on tenant-scoped Metrics
- **THEN** the rendered metrics change to reflect the window, or the control is clearly
  non-applicable at that scope (disabled/hidden/labeled)
- **AND THEN** it does not silently refetch identical data with no visible change
