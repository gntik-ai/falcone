# tenant-isolation — spec delta for fix-quota-read-tenant-scope

## ADDED Requirements

### Requirement: Quota read endpoints return cross-tenant 200

The system SHALL ensure that quota read endpoints return cross-tenant 200 is corrected: Add the own-tenant guard used by `/plan/*` to the quota read routes (kind + product).

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Cross-tenant quota reads → 403
