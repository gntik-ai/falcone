# web-console — spec delta for fix-console-operator-shell

## ADDED Requirements

### Requirement: Console operator shell role-gating (superadmin-only routes + dead session route)

The system SHALL ensure that console operator shell role-gating (superadmin-only routes + dead session route): Drive operator pages from operator-authorized routes (own-scope) or hide them by role; remove/implement `/v1/console/session`.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An operator logs in and sees their own tenant/plan/workspaces
