# web-console — spec delta for fix-747-plan-catalog-filter-crash

## ADDED Requirements

### Requirement: Console form controls read DOM event values synchronously before any deferred updater

The system SHALL read a DOM event's value (or any `currentTarget` / `target` property) synchronously
within the event handler body and capture it in a local variable, before entering any deferred
`setState` functional updater, so that the value is safely closed over and cannot be null at the time
the updater executes. The plan-catalog status filter SHALL apply this rule: the handler SHALL capture
the selected status value synchronously, pass it into the `setState` updater by closure, and trigger a
re-query of `listPlans` with the chosen status, with no thrown exception and no error boundary
activation.

#### Scenario: Selecting a status in the plan-catalog filter re-queries without crashing

- **WHEN** a superadmin selects a status (e.g. "Draft", "Active", "Deprecated", "Archived") in the
  plan-catalog status filter `<select>`
- **THEN** the catalog table re-queries `listPlans` with the selected status, the updated rows are
  displayed, and no React error boundary is triggered / no TypeError is thrown
