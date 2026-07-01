# web-console Specification (delta)

## ADDED Requirements

### Requirement: Invalidated console sessions redirect to login

The system SHALL redirect to `/login` and present the unauthenticated screen whenever the active
console session becomes unusable and cannot be refreshed, rather than continuing to render the
authenticated shell.

#### Scenario: Authenticated request and silent refresh both fail

- **WHEN** an authenticated console request returns `401` and the subsequent silent refresh also
  fails because the refresh token is expired or invalid, or because the session was revoked
- **THEN** the console clears the session and navigates to `/login`, optionally preserving the
  intended protected route, and shows the unauthenticated login screen instead of authenticated
  chrome or protected content.
