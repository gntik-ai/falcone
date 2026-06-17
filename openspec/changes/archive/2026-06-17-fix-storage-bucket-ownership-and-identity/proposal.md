Tracking issue: gntik-ai/falcone#491

## Why

`deploy/kind/control-plane/storage-handlers.mjs` resolves `listObjects(ctx.params.bucketId)` and `workspaceUsage(ctx.params.workspaceId)` without ever referencing `identity.tenantId`, producing an IDOR: any authenticated caller can list/read any bucket or workspace by id. The platform also uses **one shared SeaweedFS admin credential** with no per-tenant S3 identity or bucket policy.

Live proof (`tests/live-audit/evidence/05-storage-s3.md`): the handlers serve any bucket/workspace by id; the single shared key read both `tenant-A-secret` and `tenant-B-secret` object payloads directly.

## What Changes

- Check bucket/workspace ownership against the caller's tenant on every storage route; reject with HTTP 403 on mismatch.
- Issue per-tenant SeaweedFS identities and bucket policies (or per-tenant prefixes enforced server-side) instead of handing out a platform-wide key.

## Capabilities

### New Capabilities

### Modified Capabilities

- `storage`: Storage routes enforce bucket/workspace ownership against the caller's tenant, and each tenant has its own S3 identity scoped to its own buckets/prefixes.

## Impact

- `deploy/kind/control-plane/storage-handlers.mjs` (`listObjects`, `workspaceUsage`).
- SeaweedFS identity/bucket-policy provisioning.
- Depends on A2 (`fix-executor-enforce-credential-workspace`).
