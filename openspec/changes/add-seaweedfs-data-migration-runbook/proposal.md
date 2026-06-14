## Why

Clusters running the bundled MinIO (`charts/in-falcone/values.yaml:2043-2137`,
`storage.enabled: true`) need a scripted, repeatable path to migrate all bucket
objects to SeaweedFS so the storage engine can be swapped without data loss.
No object-upload route exists yet in the live kind runtime
(`deploy/kind/control-plane/routes.mjs:118-123`), so the bucket population is
operator-controlled; the migration tooling must still be correct for the general
case and tested against the real S3 surface.

## What Changes

- **NEW** migration script: `rclone sync` (fallback `mc mirror`) MinIO→SeaweedFS,
  per-bucket, idempotent and re-runnable for both the initial bulk pass and the
  final delta pass at cutover.
- **NEW** integrity capture: object counts + checksums/ETags written before the
  initial sync and after the final delta, consumed by the downstream
  migration-validation change.
- **NEW** cutover runbook (committed ordered checklist):
  1. Pre-cutover go/no-go compatibility gate (addressing style, presigned URLs,
     multipart, IAM/policy semantics — run against SeaweedFS; re-uses the
     adr-spike matrix).
  2. Write-freeze / maintenance-window start (default; zero-downtime dual-write
     alternative flagged as a trade-off note).
  3. Final delta sync.
  4. Re-point Falcone to SeaweedFS via the chart toggle (`storage.config.inline`
     provider fields).
  5. Validate: counts + checksums match pre-cutover snapshot.
  6. Switch traffic.
- Infrastructure/ops work only — no application source changes, no chart source
  changes beyond documentation of the toggle already introduced by
  `add-seaweedfs-deployment`.

## Capabilities

### New Capabilities

_(none — this change adds requirements to an existing capability)_

### Modified Capabilities

- `storage`: ADDED requirements for a verifiable S3→S3 data migration procedure
  with integrity capture and a gated, ordered cutover runbook; no existing
  requirements are modified or removed.

## Impact

- **In scope**: clusters where `storage.enabled: true` (bundled MinIO) in
  `charts/in-falcone/values.yaml`.
- **Out of scope**: musematic-deploy (external Hetzner S3, MinIO disabled);
  bucket/lifecycle recreation and credential recreation (owned by
  `add-seaweedfs-bucket-lifecycle-migration`); automated production cutover
  (operator-driven).
- **Dependencies**: `add-seaweedfs-deployment` (SeaweedFS runs alongside MinIO
  via chart toggle), `add-seaweedfs-bucket-lifecycle-migration` (target buckets
  exist on SeaweedFS), `adr-spike` (compatibility matrix go/no-go).
- **Blocks**: `migration-validation`, `rollback-plan`.
- **External tools**: `rclone` ≥ 1.65 or MinIO Client (`mc`) ≥ RELEASE.2024.
