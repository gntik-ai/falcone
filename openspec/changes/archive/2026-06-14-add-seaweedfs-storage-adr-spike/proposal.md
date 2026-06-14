## Why

Falcone's bundled object store relies on MinIO CE, whose console lost OIDC/SSO in May
2025 and whose flagship repo was archived in February 2026; the project's AGPLv3
network-copyleft licence is also a legal misfit for a BaaS that exposes S3 to tenants.
SeaweedFS (Apache-2.0) is the selected successor, but S3-compatibility is version-
dependent, the filer-on-PostgreSQL metadata model is untested, and three divergent S3
code paths exist in the codebase with no SeaweedFS entry in the provider registry —
so the migration cannot proceed safely without a recorded decision and empirical validation.

## What Changes

- ADR-13 is recorded in the established format (`docs-site/architecture/adrs.md`,
  sections Decision / Why / Evidence / Risks) documenting the SeaweedFS selection and
  the rejection of RustFS (alpha) and Ceph/Rook (too heavy).
- A compatibility spike is executed against a real SeaweedFS instance at a pinned
  version, covering: path-style addressing; SigV4 presigned GET; ListBuckets +
  ListObjectsV2 XML envelope shape vs the regex parser in
  `deploy/kind/control-plane/storage-handlers.mjs:76-97`; putBucketPolicy /
  getBucketPolicy / putBucketVersioning / putBucketLifecycleConfiguration /
  putBucketCors (SUPPORTED / PARTIAL / UNSUPPORTED per call); object versioning and
  object-lock / WORM; S3 gateway port (expected 8333 — confirmed or corrected); and
  filer-on-PostgreSQL configuration + namespace-ops smoke test.
- A one-tenant prototype exercises writing and reloading a SeaweedFS S3 `identities`
  config (static file + `s3.configure` API) to validate the per-tenant credential
  injection model used by `services/provisioning-orchestrator/src/appliers/storage-applier.mjs`.
- Each compatibility gap is resolved to a concrete recommendation (use / shim / drop)
  that feeds the downstream deployment, per-tenant-identities, storage-provider, and
  bucket-lifecycle-migration changes.
- No source code, charts, or tests are modified; this change produces only the ADR
  and spike findings.

## Capabilities

### New Capabilities

<!-- none: all outcomes land in the existing storage capability -->

### Modified Capabilities

- `storage`: ADDED requirements capturing the guaranteed outcomes of this spike —
  ADR-13 recorded, per-operation compatibility matrix produced and pinned to a SeaweedFS
  version, filer-on-PostgreSQL validated, S3 port and identities write/reload mechanism
  confirmed, and every gap resolved to a use/shim/drop recommendation.

## Impact

- **`docs-site/architecture/adrs.md`**: ADR-13 appended (spike deliverable, not a
  source-code change).
- **`services/adapters/src/storage-provider-profile.mjs`**: not modified here; the
  spike produces findings that the follow-on `add-storage-provider-seaweedfs` change
  will consume to add the `seaweedfs` registry entry.
- **`deploy/kind/control-plane/storage-handlers.mjs:76-97`**: regex XML parser
  validated or flagged as incompatible against real SeaweedFS responses; remediation
  is out of scope here.
- **`services/openapi-sdk-service/src/sdk-storage.mjs`**: presigned-GET path tested;
  no code change in this spike.
- **`services/provisioning-orchestrator/src/appliers/storage-applier.mjs`**: bucket-
  policy / versioning / lifecycle / CORS calls validated; identities prototype
  exercises the same injection pattern.
- **Blocked downstream changes** (consume this spike's findings): deployment manifests,
  per-tenant-identities integration, storage-provider registration, bucket-lifecycle
  migration.
