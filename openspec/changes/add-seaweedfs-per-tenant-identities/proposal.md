# add-seaweedfs-per-tenant-identities

## Change type
enhancement

## Capability
storage

## Priority
P1

## Why
Only `falcone-s3-admin` exists; with the `in-falcone-storage` keys one lists/reads/writes ALL tenants' buckets. Buckets are raw resourceIds with no tenant/workspace prefix.

**Empirical evidence (live 2-tenant E2E, 2026-06-18):** aws-sdk → `http://...:8333` ListBuckets shows both tenants; Get/Put on the other tenant's bucket succeeds; the written object appears in the victim's own REST listing.

GitHub issue #553 (epic #540). Evidence: `audit/live-campaign/evidence/22-storage-s3.md`.

## What Changes
Issue per-tenant/per-workspace SeaweedFS identities (the SeaweedFS-migration tenant-identities work) and scope each workspace's storage credential; namespace buckets by tenant/workspace.

## Impact
A workspace credential can only access its own buckets; live cross-tenant S3 probe denied.

Dependencies: Relates to epic-seaweedfs-migration (#430).
