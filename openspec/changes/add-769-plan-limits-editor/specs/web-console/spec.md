# web-console — spec delta for add-769-plan-limits-editor

## ADDED Requirements

### Requirement: Console shell error boundary

The system SHALL render a recoverable, shell-preserving error state for any `/console/*`
render error via a route-level `errorElement`, never replacing the whole application with
an unstyled stack trace.

#### Scenario: Page render error

- **WHEN** a console page throws during render
- **THEN** the shell remains and the content area shows a recoverable error state

### Requirement: Editor-grade plan Limits editing

The system SHALL present plan-limit editing with explicit commit and per-row save status,
controlled inputs, confirmation for destructive Reset, an integer guard, and an
active-vs-draft editing indicator.

#### Scenario: Reset a limit on an active plan

- **WHEN** a superadmin resets a dimension on an active assigned plan
- **THEN** the console confirms the destructive change, notes the affected tenants, and
  the row reflects the true persisted value afterward

#### Scenario: Save a limit draft explicitly

- **WHEN** a superadmin edits a limit value on `/console/plans/:planId`
- **THEN** the row shows an unsaved draft until the operator uses Save, invalid decimal
  drafts are rejected without an API call, and successful saves reconcile the visible
  value from the API-accepted and refreshed persisted profile
