# web-console — spec delta for fix-780-destructive-confirm-success-gating

## ADDED Requirements

### Requirement: Destructive confirmation runs success side effects only on success, once

The system SHALL run a destructive console operation exactly once when the operator confirms it,
and SHALL run that operation's success side effects (success feedback and a single list reload)
ONLY when the operation resolves successfully, and exactly once. When the operation fails, the
system SHALL surface an error and SHALL NOT show any success feedback or perform a reload. The
confirmation dialog SHALL be presentational with respect to the operation lifecycle: it triggers
the operation and renders the operation's error state, but SHALL NOT independently run the success
side effects — the operation's owner (the destructive-op controller) awaits the result and runs
the success side effects once on success.

#### Scenario: Destructive op fails

- **WHEN** a tenant owner confirms a destructive action (e.g. a credential revoke) and the
  backend call fails
- **THEN** the UI surfaces an error and does NOT show success feedback or perform a list reload

#### Scenario: Destructive op succeeds

- **WHEN** a destructive action is confirmed and the backend call resolves successfully
- **THEN** the UI shows success feedback and performs exactly one list reload (not a double
  reload)
