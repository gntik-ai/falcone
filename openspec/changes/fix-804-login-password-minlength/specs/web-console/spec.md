# web-console Specification (delta)

## ADDED Requirements

### Requirement: Login password field imposes no client-side minimum length exceeding policy

The system SHALL NOT impose, on the web console login form, a client-side minimum password length
greater than the platform password policy minimum (`/v1/auth/signups/policy` →
`passwordPolicy.minLength`), so that every account with a policy-valid password can submit the login
form. The backend / Keycloak password policy remains authoritative for credential validity.

#### Scenario: Policy-valid 8-character password submits

- **WHEN** the policy `passwordPolicy.minLength` is 8 and a user submits an 8-character password on
  the console `/login` form
- **THEN** the form submits and `POST /v1/auth/login-sessions` is sent — the user is not blocked by
  a client-side `minLength`.

#### Scenario: Login imposes no length floor

- **WHEN** the console renders the login password field
- **THEN** it carries no client-side `minLength` that exceeds the policy minimum from
  `/v1/auth/signups/policy` (`passwordPolicy.minLength`).
