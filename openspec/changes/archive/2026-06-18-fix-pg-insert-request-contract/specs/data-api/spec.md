# data-api — spec delta for fix-pg-insert-request-contract

## ADDED Requirements

### Requirement: Postgres data insert contract mismatch

The system SHALL ensure that postgres data insert contract mismatch is corrected: Align the handler with the contract (or vice-versa) + a contract test.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** The documented body inserts a row
