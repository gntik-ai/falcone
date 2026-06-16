## ADDED Requirements

### Requirement: A fully-set-up user MUST be able to authenticate

The system SHALL allow any newly created, fully-set-up user (enabled, email-verified, no required actions, with a password credential) to complete login via `POST /v1/auth/login-sessions` and obtain a token, rather than failing with `invalid_grant "Account is not fully set up"`.

#### Scenario: Freshly created platform user can log in

- **WHEN** a platform user is created and is fully set up, then submits credentials to `POST /v1/auth/login-sessions`
- **THEN** the system returns a valid token and the user can make an authorized call

#### Scenario: A signup can log in after creation

- **WHEN** a self-service signup completes and the user submits credentials
- **THEN** the system returns a valid token (no `invalid_grant` "Account is not fully set up")
