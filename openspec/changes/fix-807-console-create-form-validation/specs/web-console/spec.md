# web-console Specification (delta)

## ADDED Requirements

### Requirement: Console create forms validate required limits and display names before submit

The system SHALL validate console create-form fields inline before submission so that required
numeric limit fields cannot submit empty, non-numeric, zero, out-of-range, negative, `NaN`, or
`null` values, and required display-name fields cannot submit empty or whitespace-only values.
When a required create-form field is invalid, the system SHALL show a field-level error, block
the form's next or submit action, and avoid calling the create API for that form.

#### Scenario: Workspace create wizard rejects invalid numeric limits

- **WHEN** an operator enters an empty, non-numeric, zero, out-of-range, or negative value in
  `workspace-max-functions` or `workspace-max-databases` on `CreateWorkspaceWizard`
- **THEN** the wizard renders an inline error for the invalid field, disables `Siguiente`, and
  does not submit `initialLimits` containing `null`, `NaN`, zero, out-of-range, or negative values

#### Scenario: Function publish wizard rejects invalid numeric limits

- **WHEN** an operator enters an empty, non-numeric, zero, out-of-range, or negative value in
  `fn-memory` or `fn-timeout` on `PublishFunctionWizard`
- **THEN** the wizard renders an inline error for the invalid field, disables `Siguiente`, and
  does not submit `limits` containing `null`, `NaN`, zero, out-of-range, or negative values

#### Scenario: Plan create page rejects blank display name

- **WHEN** an operator submits `ConsolePlanCreatePage` with an empty or whitespace-only
  `display-name`
- **THEN** the page renders an inline display-name error and does not call `createPlan`
