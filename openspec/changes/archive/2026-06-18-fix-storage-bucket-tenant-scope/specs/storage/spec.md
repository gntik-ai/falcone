# storage — spec delta for fix-storage-bucket-tenant-scope

## ADDED Requirements

### Requirement: Physical bucket names are workspace-id scoped and registry rows are non-hijackable

The control-plane storage provisioning path SHALL derive the physical bucket name
from the globally-unique workspace id (a stable hash), NOT from the per-tenant
workspace `slug`. The `workspace_buckets` registry `ON CONFLICT (bucket_name)`
SHALL NOT reassign `workspace_id` or `tenant_id`, so a name collision can never
transfer ownership of another tenant's bucket row.

#### Scenario: same-slug workspaces across tenants get distinct buckets

- **WHEN** tenant A and tenant B each provision a bucket in their respective
  `app-staging` workspaces (same slug, different workspace ids), with or without an
  explicit name
- **THEN** each receives a distinct physical bucket name and a distinct registry row
- **AND** neither tenant's `workspace_buckets` row is overwritten and neither bucket
  disappears from its owner's listing.

#### Scenario: re-provisioning a bucket is idempotent and owner-stable

- **WHEN** the owning tenant provisions the same bucket twice
- **THEN** the second call returns the original registry row (idempotent) with the
  owner (`workspace_id`/`tenant_id`) unchanged.
