# web-console - spec delta for fix-802-plan-lifecycle-console

## ADDED Requirements

### Requirement: Plan lifecycle and removal in the web console

The system SHALL provide superadmin controls in the web console to transition a plan
across its lifecycle states and to delete/retire a plan, each destructive transition
guarded by an explicit confirmation, so the full plan lifecycle is operable without
direct API access.

#### Scenario: Lifecycle transition from the console

- **WHEN** a superadmin selects a lifecycle action on a plan in the console
- **THEN** the corresponding transition is applied and the plan's displayed status updates
  accordingly

#### Scenario: Deleting a plan from the console

- **WHEN** a superadmin confirms deletion of a plan that is not in use
- **THEN** the plan is removed and no longer appears in the catalog

#### Scenario: Retiring a plan from the console

- **WHEN** a superadmin confirms a destructive lifecycle transition such as deprecating or
  archiving a plan
- **THEN** the transition is submitted only after confirmation and the plan detail page
  reflects the new lifecycle status after success
