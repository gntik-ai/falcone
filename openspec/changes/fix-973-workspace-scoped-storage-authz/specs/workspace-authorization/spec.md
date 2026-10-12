## ADDED Requirements

### Requirement: Workspace-scoped storage bucket reads

The control plane SHALL authorize storage bucket reads from the verified caller's
roles, tenantId and workspaceIds and the registry bucket's tenant_id and workspace_id.
It SHALL permit superadmin/internal callers, callers granted bucket.read,
bucket.write or bucket.admin by the shipped authorization model, and same-tenant
callers with a tenant-tier role and an explicit matching workspaceIds binding.
It SHALL deny every other caller with 404 BUCKET_NOT_FOUND before any S3 operation.
Denied responses SHALL contain no object bytes, size or etag.

The gate SHALL cover object GET, object metadata/HEAD, object listing,
workspace-addressed export/manifest/import routes, and the initial bucket gate for
structural object writes. Bucket listing SHALL omit every bucket the gate denies.
Object PUT/DELETE SHALL retain their separate tenant owner/admin structural gate.
Authorization SHALL NOT derive grants from request body, query, path or headers.
Non-admin callers SHALL be denied for a missing or null workspace mapping.

#### Scenario: Tenant viewer or developer without a workspace grant

- **WHEN** an unbound tenant_viewer or tenant_developer requests GET, HEAD or an
  object list for a bucket in workspace ws2 of its own tenant
- **THEN** the response is 404 BUCKET_NOT_FOUND with no object bytes or metadata
- **AND** no S3 operation occurs
- **AND** GET /v1/storage/buckets omits that bucket

#### Scenario: Development binding does not grant production access

- **WHEN** a ws1-bound tenant_developer or workspace_viewer requests GET, HEAD or
  an object list for a bucket in ws2 of the same tenant
- **THEN** the response is 404 BUCKET_NOT_FOUND before any S3 operation
- **AND** the bucket listing includes only authorized ws1 buckets

#### Scenario: Explicit production binding grants model-authorized reads

- **WHEN** a caller with a tenant-tier role or a workspace role granting bucket
  read, write or admin is bound to ws2 and reads a ws2 bucket in its verified tenant
- **THEN** GET, HEAD and object listing succeed with their existing response shapes
- **AND** GET returns the byte-identical object payload
- **AND** satisfiable Range requests return 206 with the requested bytes
- **AND** unsatisfiable Range requests retain 416 STORAGE_RANGE_NOT_SATISFIABLE

#### Scenario: Tenant and platform administrators retain authority

- **WHEN** tenant_owner or tenant_admin requests a bucket in any workspace of its tenant
- **THEN** reads and structural writes retain their existing authorized behavior
- **AND** superadmin/internal behavior remains unchanged across tenants

#### Scenario: Matching workspace path is insufficient authority

- **WHEN** an unbound or ws1-bound same-tenant caller requests a workspace-addressed
  bucket route with a ws2 path that correctly matches the bucket's ws2 mapping
- **THEN** the response is 404 BUCKET_NOT_FOUND before S3
- **AND** an authorized non-platform caller using a different workspace path is denied

#### Scenario: Missing mapping fails closed

- **WHEN** a non-admin caller requests a bucket with null or missing workspace_id,
  or a bucket absent from the registry
- **THEN** the response is 404 BUCKET_NOT_FOUND before S3

#### Scenario: Existing denial and validation behavior is preserved

- **WHEN** a non-platform caller requests another tenant's bucket
- **THEN** the existing 404 BUCKET_NOT_FOUND no-leak shape is preserved
- **WHEN** a request contains a malformed object key
- **THEN** 400 INVALID_OBJECT_KEY is returned before database authorization or S3
- **WHEN** a bound workspace reader attempts object PUT or DELETE without tenant
  owner/admin structural authority
- **THEN** the existing 403 FORBIDDEN structural-role denial is preserved
