# data-api — spec delta for fix-executor-ddl-db-ownership-guard

## ADDED Requirements

### Requirement: Executor DDL must validate target-DB ownership + close the trust-header boundary

The system SHALL ensure that executor DDL must validate target-DB ownership + close the trust-header boundary: Resolve/validate the target DB against the caller's workspace ownership; reject `in_falcone` and non-owned DBs (fail-closed); set `GATEWAY_SHARED_SECRET` on the executor so it does not openly honor trust headers.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** DDL on a non-owned DB or `in_falcone` -> 403
