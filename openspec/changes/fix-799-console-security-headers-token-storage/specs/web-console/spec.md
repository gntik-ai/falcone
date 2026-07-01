# web-console Specification (delta)

## ADDED Requirements

### Requirement: Baseline web-console security headers

The system SHALL serve the web console and its assets with `Content-Security-Policy` (including
`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy`, and `Permissions-Policy`.

#### Scenario: framing is refused

- **WHEN** the console is embedded in a cross-origin iframe
- **THEN** the browser refuses to render it.

#### Scenario: hardened session credential handling

- **WHEN** a user authenticates to the console
- **THEN** the session/refresh credential is not exposed to arbitrary page script (httpOnly cookie
  or an equivalently strict CSP), instead of full access+refresh JWTs in JS-accessible storage with
  no CSP.
