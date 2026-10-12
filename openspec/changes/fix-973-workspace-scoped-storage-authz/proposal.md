# Enforce workspace-scoped authorization on storage data reads

## Why

Issue #973: storage reads compare only the bucket's tenant to the caller's tenant.
An unbound tenant_viewer can download production object bytes, and a development
workspace member can read another workspace's objects in the same tenant. This
violates AUTHZ-XWS-002: tenant membership does not grant another workspace.

## What Changes

- Add a shared bucket read gate using the already loaded model-authz can() helper.
  Permit superadmin/internal, model bucket.read/write/admin grants, or a verified
  tenant-tier role with an explicit matching identity.workspaceIds binding.
- Apply the gate to object GET, metadata/HEAD, object listing, workspace-addressed
  export/manifest/import routes, and the first gate on structural object writes.
  Reuse the registry record so structural writes require one authorization lookup.
- Filter bucket listings through the same gate, authorizing mappings before S3.
  An unbound non-admin sees no buckets; a ws1-bound caller sees only ws1 buckets.
- Preserve 404 BUCKET_NOT_FOUND without object bytes or metadata on denial,
  cross-tenant isolation, object-key validation before database/S3, binary bytes,
  Range/416 behavior, and the separate owner/admin structural write gate.
- Fail closed on absent workspace mappings for non-admin callers. Tenant owner
  and admin model grants remain tenant-wide; platform/internal behavior is unchanged.

## Scope and Compatibility

Authorization uses only verified identity.roles, tenantId and workspaceIds, never
request body, query, path or x-* headers. The path workspace must still match the
bucket for non-platform workspace-addressed requests; matching alone grants nothing.
No contract is read per request and no authorization matrix is changed.

Unbound tenant_developer and tenant_viewer users intentionally lose storage reads.
Existing users without workspace_id must be rebound through createTenantUser's
workspaceId before reading workspace buckets. Bound tenant roles retain reads in
their assigned workspace. Workspace grants do not widen PUT/DELETE authority.

The gate requires verified realm roles for tenant owner/admin grants. A token
carrying actor_type=tenant_owner without a tenant_owner or tenant_admin realm role
loses bucket access, including the initial read gate before structural writes.
The current charts do not mint actor_type; clients must rely on verified roles.

No claim minting, membership table, migration, dependency change, deployment chart,
shared tenant management gate or non-storage resolver is included. Functions,
MongoDB, PostgreSQL, Kafka, webhooks and route-auth tier enforcement remain separate
follow-ups. Rollback is a source revert and the normal previous-image-digest release.

## Verification Seams

Tests drive the exported STORAGE_HANDLERS using fake PostgreSQL pool and S3 fetch
boundaries. They observe handler status, response bytes and metadata, bucket lists,
and whether any S3 operation occurred on denial. The fixtures contain development
ws1 and production ws2 in tenant T, plus foreign/unmapped buckets as controls.

R3 human approval and independent maker/checker review by both providers remain
delivery gates. The control plane must build an immutable image and replay the
original issue reproduction after deployment; the source maker does neither.
