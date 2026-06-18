# storage — spec delta for add-seaweedfs-per-tenant-identities

## ADDED Requirements

### Requirement: SeaweedFS uses one shared root S3 identity (cross-tenant at the object layer)

The system SHALL ensure that seaweedFS uses one shared root S3 identity (cross-tenant at the object layer) is corrected: Issue per-tenant/per-workspace SeaweedFS identities (the SeaweedFS-migration tenant-identities work) and scope each workspace's storage credential; namespace buckets by tenant/workspace.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** A workspace credential can only access its own buckets
