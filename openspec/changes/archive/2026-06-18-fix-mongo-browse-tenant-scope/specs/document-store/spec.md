# document-store — spec delta for fix-mongo-browse-tenant-scope

## ADDED Requirements

### Requirement: Mongo document/browse handlers leak cross-tenant documents

The system SHALL ensure that mongo document/browse handlers leak cross-tenant documents is corrected: Scope the control-plane mongo handlers by the caller's tenant (filter by `tenantId`, restrict listable names to the caller's workspaces) or route document reads through the scoped executor.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Cross-tenant document read/list → empty/403
