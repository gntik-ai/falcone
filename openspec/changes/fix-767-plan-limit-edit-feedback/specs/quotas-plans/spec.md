# quotas-plans - spec delta for fix-767-plan-limit-edit-feedback

## MODIFIED Requirements

### Requirement: Plan limit write responses support console reconciliation

The system SHALL reject invalid plan-limit values before persistence, including fractional
values and values less than `-1`, with a non-2xx error such as 400
`INVALID_LIMIT_VALUE`. When a plan-limit write succeeds, the API response SHALL include the
accepted dimension key, accepted value, and source needed by clients to reconcile their
displayed row: PUT returns `newValue` and `source`, and DELETE returns the reverted
`effectiveValue` and `source`.

#### Scenario: Invalid value is rejected

- **WHEN** a superadmin sends a plan-limit PUT with a fractional value or a value less than
  `-1`
- **THEN** the API rejects the request with `INVALID_LIMIT_VALUE` and does not persist the
  rejected value

#### Scenario: Successful write returns accepted value

- **WHEN** a superadmin sends a valid plan-limit PUT and the request succeeds
- **THEN** the API returns the accepted `newValue` and `source` for the dimension

#### Scenario: Successful reset returns reverted effective value

- **WHEN** a superadmin sends a plan-limit DELETE and the request succeeds
- **THEN** the API returns the reverted `effectiveValue` and `source` for the dimension
