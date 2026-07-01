# web-console Specification (delta)

## ADDED Requirements

### Requirement: Password-recovery entry point reaches a real view

The system SHALL route the login page's password-recovery link to a functional
password-recovery view, or hide the link if recovery is not offered, and SHALL
never route that entry point to a 404 dead end.

#### Scenario: Login forgot-password link opens recovery view

- **WHEN** an unauthenticated user clicks "¿Olvidaste tu contraseña?" on
  `/login`
- **THEN** a password-recovery view renders instead of NotFound, with a way to
  proceed and a way back to login.

#### Scenario: Recovery endpoint unavailable stays on recovery view

- **WHEN** the password-recovery view submits to
  `POST /v1/auth/password-recovery-requests` and the runtime responds `404`
  because the handler is not registered
- **THEN** the view shows that recovery is not enabled in the current runtime,
  keeps the back-to-login affordance, and does not present a successful reset or
  fall through to NotFound.
