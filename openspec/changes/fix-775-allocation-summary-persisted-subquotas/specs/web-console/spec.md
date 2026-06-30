# web-console - spec delta for fix-775-allocation-summary-persisted-subquotas

## MODIFIED Requirements

### Requirement: Allocation page renders persisted workspace allocation summaries

The system SHALL render `/console/my-plan/allocation` from the allocation-summary API
response so that a dimension with persisted workspace sub-quota rows appears in the
populated `WorkspaceAllocationSummaryTable`, and the "no allocations" empty state appears
only when every returned dimension has `workspaces: []`.

#### Scenario: Console renders populated allocation table

- **WHEN** the allocation summary for a tenant contains a dimension whose `workspaces`
  breakdown includes a persisted workspace allocation
- **THEN** the console renders the populated allocation table with that workspace
  breakdown instead of the "No workspace allocations yet" empty state

#### Scenario: Console renders no-allocation empty state

- **WHEN** the allocation summary for a tenant returns every dimension with
  `workspaces: []`
- **THEN** the console shows the "no allocations" empty state
