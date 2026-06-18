# access-policies — spec delta for add-project-auth-config-api

## ADDED Requirements

### Requirement: No Falcone API to manage a project's auth methods / identity providers

The system SHALL ensure that no Falcone API to manage a project's auth methods / identity providers is corrected: Add owner APIs to toggle auth methods + configure social providers per project, and apply the template's required scopes at realm provisioning.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An owner enables username/password + a social provider via the API and the realm's login options reflect it
