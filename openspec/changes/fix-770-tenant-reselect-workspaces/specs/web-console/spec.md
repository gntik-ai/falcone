# web-console Specification (delta)

## MODIFIED Requirements

### Requirement: Tenant selection keeps the workspace list consistent

The system SHALL, on any tenant-selection event, leave the workspace selector in a consistent state:
preserving the existing workspace list and active workspace when the selected tenant is unchanged,
or reloading workspaces when the list is already empty or errored. The system SHALL never leave the
workspace selector permanently empty without a reload path after a tenant-selection event.

#### Scenario: Re-selecting the already-active tenant

- **WHEN** the tenant selector's change handler runs for the tenant that is already active
- **THEN** the workspace list is preserved or refetched
- **AND THEN** a `GET /v1/workspaces` is issued if the active tenant's workspace list was already
  empty or errored
- **AND THEN** the selector is never stuck on an empty "no accessible workspaces" state

#### Scenario: Cleared workspace list is recoverable

- **WHEN** the workspace list becomes empty for any reason other than a genuine empty tenant
- **THEN** the console offers a workspace retry affordance even when `workspacesError` is not set
- **AND THEN** activating that retry triggers the existing workspace reload path for the active
  tenant
