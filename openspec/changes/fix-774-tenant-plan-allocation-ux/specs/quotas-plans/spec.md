# quotas-plans — spec delta for fix-774-tenant-plan-allocation-ux

## ADDED Requirements

### Requirement: Tenant plan and allocation views are navigable, honest, and design-system-consistent

The system SHALL render the tenant-facing allocation view header-first in every
state, signal tenant plan quota breaches accurately with destructive semantics,
present allocation data with units and human-readable workspace labels, and
reuse the shared console design-system primitives and dark-aware tokens.

#### Scenario: Empty allocation state keeps wayfinding

- **WHEN** a tenant owner opens `/console/my-plan/allocation` and the allocation
  summary has no workspace sub-quota allocations
- **THEN** the page heading and wayfinding render before the empty state, and
  the empty state is shown via `ConsolePageState` with an icon rather than a
  title-less orphan card.

#### Scenario: Over-limit quota is visibly a breach

- **WHEN** a tenant plan quota dimension's usage exceeds its effective limit
- **THEN** the tenant plan view renders the aggregate breach as a destructive
  alert and the per-row consumption/status controls show a non-neutral breach
  state with a semantic badge.

#### Scenario: Allocation breakdown values and workspace labels are legible

- **WHEN** the allocation table shows a dimension with per-workspace
  allocations
- **THEN** numeric allocation values carry the dimension unit, workspace entries
  are shown as separate human-readable labels where possible, and raw UUID
  tenant/workspace identifiers are not surfaced as the primary copy.
