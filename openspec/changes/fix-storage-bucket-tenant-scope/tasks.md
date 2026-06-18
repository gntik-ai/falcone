# Tasks — fix-storage-bucket-tenant-scope

## Reproduce (test-first)
- [x] `tests/blackbox/storage-bucket-tenant-scope.test.mjs` — fails on the old code: `deriveBucketName` export is absent and `insertBucket`'s ON CONFLICT reassigns `workspace_id`/`tenant_id` (hijack).

## Implement (kind runtime AND shippable product as applicable)
- [x] `storage-handlers.mjs`: new exported `deriveBucketName(workspaceId, name)` — DNS-safe name embedding a stable hash of the unique workspace id (mirrors product `deriveWorkspaceBucketName`); `storageProvisionBucket` uses it.
- [x] `tenant-store.mjs::insertBucket`: `ON CONFLICT (bucket_name)` no longer reassigns `workspace_id`/`tenant_id` (idempotent, owner-stable).

## Verify
- [x] `node --test tests/blackbox/storage-bucket-tenant-scope.test.mjs` green; existing storage/seaweedfs tests unaffected.
- [x] Acceptance: same-slug workspaces across tenants get distinct buckets; neither can hijack the other's registry row.

## Archive
- [ ] `openspec validate fix-storage-bucket-tenant-scope --strict`; `/opsx:archive fix-storage-bucket-tenant-scope` after merge.
