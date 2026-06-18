# storage — spec delta for fix-activate-seaweedfs-tenant-identities

## ADDED Requirements

### Requirement: Activate per-tenant SeaweedFS identities (single shared admin S3 credential)

The system SHALL ensure that activate per-tenant SeaweedFS identities (single shared admin S3 credential): Ensure the flag is set in every profile (or default-on); verify the per-workspace identity provision/rotate/revoke path issues real per-tenant SeaweedFS credentials and the storage API vends them.

#### Scenario: corrected behavior verified end-to-end

- **WHEN** the conditions in the reproduction are exercised against the running system
- **THEN** Each workspace gets a distinct S3 identity scoped to its bucket prefix
