# web-console Specification (delta)

## MODIFIED Requirements

### Requirement: Console signup reflects and honors the self-service policy

The system SHALL derive the console's signup availability from the same policy
contract the backend emits, and SHALL provide every field the signup endpoint
requires, including tenant context, so an enabled self-service policy yields a
completable signup.

#### Scenario: Enabled policy renders a usable form

- **WHEN** `GET /v1/auth/signups/policy` reports self-service signup enabled
  through `selfServiceEnabled: true`
- **THEN** `/signup` renders an enabled form and `/login` shows the signup entry
  point, using the runtime policy fields rather than absent legacy fields such
  as `allowed`.

#### Scenario: Submit includes required tenant context

- **WHEN** a user submits the self-service signup form
- **THEN** the request includes the tenant context the backend requires and the
  registration succeeds or continues to pending activation without a
  `tenantId is required` rejection.

#### Scenario: Signup password minimum follows the advertised policy

- **WHEN** the signup policy advertises `passwordPolicy.minLength`
- **THEN** the signup password field uses that value as its client-side minimum
  instead of a hardcoded minimum that can drift from the runtime policy.
