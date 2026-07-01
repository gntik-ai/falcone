# web-console Specification (delta)

## ADDED Requirements

### Requirement: Login invalid credentials errors use credentials feedback

The system SHALL present a wrong-credentials message when the web console login request fails with
HTTP `401` and error code `INVALID_CREDENTIALS`, distinct from a service-unavailable message.

#### Scenario: 401 INVALID_CREDENTIALS shows credentials error

- **WHEN** the user submits invalid credentials and the API responds to
  `POST /v1/auth/login-sessions` with HTTP `401` and `code: INVALID_CREDENTIALS`
- **THEN** the console shows a credentials-specific error and does not show a service-outage
  heading.

#### Scenario: Operational login failure shows service-unavailable error

- **WHEN** the user submits the login form and the API responds with an operational failure such as
  HTTP `503`
- **THEN** the console shows the service-unavailable message rather than the wrong-credentials
  message.
