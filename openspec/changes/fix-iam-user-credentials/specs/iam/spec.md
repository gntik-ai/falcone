# iam — spec delta for fix-iam-user-credentials

## ADDED Requirements

### Requirement: IAM user creation drops the credentials (app end-users created without a password)

The system SHALL ensure that iAM user creation drops the credentials (app end-users created without a password): Pass the credentials through to Keycloak on create (or expose a set-password sub-route).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A user created with a password can immediately log in
