# tenant-isolation — spec delta for fix-metrics-tenant-authorization

## ADDED Requirements

### Requirement: Metrics endpoints have no tenant authorization (data leak)

The system SHALL ensure that metrics endpoints have no tenant authorization (data leak) is corrected: Apply the own-tenant guard used by `/plan/*` (tenant_owner→own only, superadmin→any) to ALL metrics routes, in the kind `metrics-handlers.mjs` and the product metrics handler.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Cross-tenant metrics → 403
