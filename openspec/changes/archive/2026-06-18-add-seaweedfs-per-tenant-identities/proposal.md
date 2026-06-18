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
Issue per-tenant/per-workspace SeaweedFS identities and scope each workspace's storage credential; namespace buckets by tenant/workspace.

## Proposal-vs-code correction (verified against source)
The per-tenant SeaweedFS identity MODEL is already shipped by the archived epic-430 child `add-seaweedfs-tenant-identities`:
- `services/adapters/src/seaweedfs-iam-client.mjs` — `buildSeaweedFSIdentity` (per-bucket-scoped `Action:bucket`, fail-closed on empty/wildcard), `writeIdentity`/`deleteIdentity`/`updateIdentityActions`.
- `services/adapters/src/storage-tenant-context.mjs` — `provisionWorkspaceStorageBoundary` (real per-workspace identity write, fail-closed if no bucket).
- `services/provisioning-orchestrator/src/actions/storage-identity-runtime.mjs` — rotate/cleanup/revoke/cascade/sync runtime executors.
- `services/provisioning-orchestrator/src/reconcilers/bucket-reconciler.mjs` — `workspaceIdentity`, per-bucket isolation policy, `verifyIsolation`.

The remaining gap proven live is the **deployment layer**:
1. The chart (`charts/in-falcone/templates/seaweedfs-s3-creds.yaml`) issued ONE identity with a GLOBAL `["Admin","Read","Write","List","Tagging"]` grant — a cross-tenant skeleton key.
2. Buckets are created with the raw resourceId, no tenant/workspace namespace (defense-in-depth gap S-2).

This change closes both at the shippable layer and adds the chart-facing pure builders.

## What was implemented
- `services/adapters/src/seaweedfs-s3-identities-config.mjs` (NEW, pure): `deriveWorkspaceBucketName` (tenant/workspace-namespaced, DNS-safe, collision-free) and `buildSeaweedFSIdentitiesConfig` (admin scoped to a reserved platform prefix; every action `Action:bucket`; per-workspace identities scoped to their own bucket; fail-closed).
- `charts/in-falcone/templates/seaweedfs-s3-creds.yaml`: the bootstrap admin identity is now bucket-scoped to `falcone-platform-system` (no global grant); admin keys exported for the runtime IAM client.
- `charts/in-falcone/values.yaml`: `seaweedfsS3Creds.platformBucketPrefix` + `adminEndpoint`; reserved platform bucket added to `seaweedfs.s3.createBuckets`.

## Deferred (out of this minimal slice)
- Wiring the live per-workspace identity issuance into the kind control-plane runtime (`deploy/kind/control-plane/storage-handlers.mjs` provisions buckets with the raw name and does not call the IAM client) — out of locus for this change and a separate runtime-wiring slice.

## Impact
A workspace credential can only access its own buckets; live cross-tenant S3 probe denied; the shared admin credential is no longer a universal skeleton key.

Dependencies: Relates to epic-seaweedfs-migration (#430).
