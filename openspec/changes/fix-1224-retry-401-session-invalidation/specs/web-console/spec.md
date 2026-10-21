## ADDED Requirements

### Requirement: Next-only invalidation after an unauthorized request retry

The shared request API SHALL have an opt-in handler with no default. Only the
next-console bootstrap SHALL register it. It SHALL run only when the existing
post-refresh retry rejects with numeric status 401, and SHALL rethrow that error.
Refresh deduplication, refresh retry policy and request retry order SHALL remain
unchanged. The handler SHALL make no request and SHALL NOT terminate the remote
login session.

#### Scenario: Successful refresh followed by another 401

- **WHEN** a guarded GET receives 401, refresh succeeds, and its retry receives 401
- **THEN** exactly two GETs and one refresh POST SHALL occur at both `/` and `/next/`
- **AND** the persisted session SHALL be cleared, the expired hint stored, and the
  configured login route displayed without an ErrorPanel or 401/network copy
- **AND** `/next/` intent SHALL preserve the full path, query and hash.

#### Scenario: Concurrent retry 401s

- **WHEN** two guarded requests both reject with 401 after their retries
- **THEN** the persisted-session check SHALL permit exactly one clear, invalidation
  event and navigation to login; later invalidations with no session SHALL do nothing.

#### Scenario: Existing refresh outcomes

- **WHEN** refresh is rejected following an initial 401 at either basename
- **THEN** the existing login redirect and expired hint SHALL remain.
- **WHEN** refresh succeeds and the request retry succeeds
- **THEN** the page SHALL render without redirect and the refreshed session SHALL persist.

#### Scenario: No registration or an excluded error

- **WHEN** no handler is registered and the retry returns 401
- **THEN** the error SHALL be rethrown, the refreshed session SHALL persist, and no
  event SHALL be emitted, with the same refresh count as the registered case.
- **WHEN** a retry returns 403, 500 or a network error, or there is no access token
- **THEN** the handler SHALL NOT run.

### Requirement: Preserve legacy behavior and bounded test expectations

The legacy app SHALL remain unchanged and SHALL NOT register the handler. No next
page SHALL import `refreshConsoleShellSession`. No test SHALL be removed or disabled.

#### Scenario: Authorized 401 expectation amendment

- **WHEN** overview parity tests exercise workspaces 401 in es or en
- **THEN** they SHALL assert the login heading, as SHALL the shell-prerequisite 401 row.
- **AND** 403, 404, 500 and network expectations SHALL remain unchanged.
