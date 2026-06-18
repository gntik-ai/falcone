# Tasks — fix-activate-seaweedfs-tenant-identities

## Reproduce (test-first)
- [x] `tests/blackbox/seaweedfs-tenant-identities-default-on.test.mjs` — fails on old code: `tenantIdentitiesEnabled` does not exist and issuance was gated on `=== '1'` (dropped by an env-list overlay → `storageCredential: null`).

## Implement (kind runtime AND shippable product as applicable)
- [x] `storage-handlers.mjs`: new exported `tenantIdentitiesEnabled(env)` — DEFAULT-ON (disabled only by explicit `0/false/off/no`); the provision path uses it so an env-list overlay can no longer silently disable per-tenant identities.
- [x] `tests/live-campaign/values-campaign.yaml`: re-add `STORAGE_TENANT_IDENTITIES=1` to the (full-replace) control-plane env list so the campaign profile documents the intent. (`deploy/kind/values-kind.yaml` already sets it.)

## Verify
- [x] `node --test tests/blackbox/seaweedfs-tenant-identities-default-on.test.mjs` green; seaweedfs identity + storage IDOR/scope tests unaffected.
- [x] Acceptance: each provisioned bucket vends a distinct, bucket-scoped S3 credential even when the env flag is absent; tenant A's S3 credential cannot access tenant B's buckets (mechanism from #553, verified live).

## Archive
- [ ] `openspec validate fix-activate-seaweedfs-tenant-identities --strict`; `/opsx:archive fix-activate-seaweedfs-tenant-identities` after merge.
