## ADDED Requirements

### Requirement: Storage routes MUST enforce bucket and workspace ownership

The system SHALL verify that the `bucketId`/`workspaceId` in a storage request belongs to the caller's tenant before serving it, and SHALL reject any request for a bucket or workspace owned by another tenant with HTTP 403.

#### Scenario: Cross-tenant bucket access is rejected

- **WHEN** Tenant B's credential calls a storage route for a `bucketId`/`workspaceId` owned by Tenant A
- **THEN** the system returns HTTP 403 and does not list or return any of Tenant A's objects or usage

#### Scenario: Tenant lists only its own buckets

- **WHEN** a tenant lists objects or workspace usage for a bucket it owns
- **THEN** the system returns only that tenant's objects/usage

### Requirement: Each tenant MUST have an isolated S3 identity

The system SHALL provision a per-tenant SeaweedFS identity with a bucket policy (or server-enforced per-tenant prefix) and SHALL NOT use a single shared platform-wide credential for tenant object I/O, so that a per-tenant credential cannot reach another tenant's prefix.

#### Scenario: Per-tenant credential cannot reach a foreign prefix

- **WHEN** a tenant uses its own S3 identity to access an object under another tenant's prefix
- **THEN** the storage backend denies the access
