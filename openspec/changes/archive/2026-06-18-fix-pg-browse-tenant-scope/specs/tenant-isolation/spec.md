# tenant-isolation — spec delta for fix-pg-browse-tenant-scope

## ADDED Requirements

### Requirement: Postgres metadata browser leaks cross-tenant schema/catalog

The system SHALL ensure that postgres metadata browser leaks cross-tenant schema/catalog is corrected: Restrict the database list to `workspace_databases` rows owned by the caller's tenant; reject browse on non-owned DBs; never expose `in_falcone`.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** acme sees only acme's DBs
