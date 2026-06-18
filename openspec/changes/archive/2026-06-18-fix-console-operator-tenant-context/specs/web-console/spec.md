# web-console — spec delta for fix-console-operator-tenant-context

## ADDED Requirements

### Requirement: Console shell unusable for tenant operators

The system SHALL ensure that console shell unusable for tenant operators is corrected: Drive operator context from `/v1/workspaces` / `/v1/tenant/*` (own-scope) instead of the superadmin tenant list; fix the singular `/v1/tenant/plan` route authz.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** An operator logs in and sees their own tenant/workspaces/plan
