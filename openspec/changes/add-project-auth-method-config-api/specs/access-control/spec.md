# access-control — spec delta for add-project-auth-method-config-api

## ADDED Requirements

### Requirement: Project auth-method / identity-provider configuration API

The system SHALL ensure that project auth-method / identity-provider configuration API: A project-scoped API to toggle auth methods + configure social providers (credentials redacted).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An owner enables/disables a method via the API and the app's login options reflect it
