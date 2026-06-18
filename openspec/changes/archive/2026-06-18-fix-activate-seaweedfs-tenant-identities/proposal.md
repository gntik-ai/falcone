# fix-activate-seaweedfs-tenant-identities

## Change type
bugfix

## Capability
storage

## Priority
P1

## Why
`STORAGE_TENANT_IDENTITIES` is absent from the deployed control-plane env (the values overlay's full-list env replace drops it); every storage provision returns `storageCredential:null`; a single shared admin S3 identity reads/writes all tenants' buckets. (#553 shipped the mechanism but it is gated off here.)

**Empirical evidence (live 2-tenant E2E re-run, fresh HEAD install, 2026-06-18):** Deployed control-plane pod env has only STORAGE_S3_ENDPOINT/ACCESS_KEY/SECRET_KEY (no STORAGE_TENANT_IDENTITIES); direct S3 admin cred lists/reads/writes both tenants' buckets.

GitHub epic B. Evidence: `audit/live-campaign/evidence-rerun/13-storage-events-functions.md`.

## What Changes
Ensure the flag is set in every profile (or default-on); verify the per-workspace identity provision/rotate/revoke path issues real per-tenant SeaweedFS credentials and the storage API vends them.

## Impact
Each workspace gets a distinct S3 identity scoped to its bucket prefix; tenant A's S3 credential cannot access tenant B's buckets.

Dependencies: Relates to epic-seaweedfs-migration (#430).
