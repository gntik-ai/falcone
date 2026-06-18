# audit — spec delta for fix-audit-enforcement-logging

## ADDED Requirements

### Requirement: Enforcement decisions write a correlated audit row

When the control plane denies an action by enforcing a limit or a scope boundary, it SHALL
write a correlated audit row at the enforcement point (best-effort; auditing never fails or
blocks the response):

- A quota denial (402 QUOTA_EXCEEDED) SHALL write a `quota_enforcement_log` row carrying the
  dimension, the effective limit/ceiling, the decision, the actor, and the request correlation id.
- A scope denial (403 from a control-plane handler — e.g. a cross-tenant access) SHALL write a
  `scope_enforcement_denials` row carrying the caller's tenant, actor, request method/path, and
  the request correlation id (a correlation id is generated when the request did not supply one).

The denial row SHALL be attributed to the caller's verified tenant + actor (never from the
request body), and a non-denied (2xx) response SHALL write no enforcement row.

#### Scenario: a quota denial writes a correlated quota_enforcement_log row

- **WHEN** a workspace create is rejected with 402 QUOTA_EXCEEDED
- **THEN** a `quota_enforcement_log` row exists with the dimension, decision, actor, and the request correlation id

#### Scenario: a scope denial writes a correlated scope_enforcement_denials row

- **WHEN** a control-plane handler returns 403 (e.g. a cross-tenant access)
- **THEN** a `scope_enforcement_denials` row exists for the caller's tenant + actor with the request correlation id

#### Scenario: a successful action writes no enforcement denial

- **WHEN** a control-plane action succeeds (2xx)
- **THEN** no `scope_enforcement_denials` row is written for it
