# storage — spec delta for fix-storage-bucket-tenant-scope

## ADDED Requirements

### Requirement: Storage: scope the bucket registry by workspace (slug-name collision hijacks tenant_id)

The system SHALL ensure that storage: scope the bucket registry by workspace (slug-name collision hijacks tenant_id): Include the workspace id in the physical bucket name; key the registry by `(workspace_id, bucket_name)`; never let `ON CONFLICT` cross tenant_id.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Same-slug workspaces across tenants get distinct buckets
