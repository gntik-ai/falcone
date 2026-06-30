# web-console - spec delta for fix-767-plan-limit-edit-feedback

## MODIFIED Requirements

### Requirement: Plan limit editing persists with explicit feedback

The system SHALL await each plan-limit write from the superadmin
`/console/plans/{planId}` Limits tab, SHALL surface a success confirmation on 2xx and an
explicit, localized error on failure (for example 400 `INVALID_LIMIT_VALUE` or 409
`PLAN_LIMITS_FROZEN`), and SHALL only update the displayed limit to a value the API has
accepted or the refreshed limits profile reports. The console SHALL NOT optimistically
display a rejected or failed value as a saved limit.

#### Scenario: Rejected edit

- **WHEN** a superadmin edits a dimension's limit on `/console/plans/{planId}` to a value
  the API rejects and the write returns a non-2xx status
- **THEN** the console shows the error and the dimension row continues to display the last
  successfully persisted value, with no phantom saved value

#### Scenario: Successful edit

- **WHEN** a plan-limit edit returns 200
- **THEN** the row reflects the API-returned `newValue`/`source` or the reconciled limits
  profile, and a success affordance is shown

#### Scenario: Reset reflects the real default

- **WHEN** a superadmin clicks "Reset" on a dimension and the DELETE override request
  succeeds
- **THEN** the editable field shows the actual reverted/default value returned by the API
  or refreshed profile without requiring a page reload
