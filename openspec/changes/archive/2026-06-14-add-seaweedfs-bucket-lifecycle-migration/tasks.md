## 1. Canonical Mapping Consolidation

- [x] 1.1 Confirm `workspace_buckets` schema in `deploy/kind/control-plane/tenant-store.mjs:67-75` covers all existing workspaces; document any gaps found
- [x] 1.2 Annotate `services/adapters/src/storage-logical-organization.mjs` as legacy (no new call sites); verify no production path creates buckets via the prefix-per-tenant strategy
- [x] 1.3 Annotate `services/provisioning-orchestrator/src/collectors/s3-collector.mjs:74-75` `<tenantId>-` prefix logic as legacy; verify no production path creates buckets via that strategy
- [x] 1.4 Write a unit test that asserts all bucket-create code paths route through `workspace_buckets` and not through the two legacy strategies

## 2. DNS-Sanitization Validation Module

- [x] 2.1 Extract the DNS-sanitization rule from `deploy/kind/control-plane/storage-handlers.mjs:182-184` into a shared validation utility (`services/provisioning-orchestrator/src/utils/bucket-name-validator.mjs`)
- [x] 2.2 Write unit tests for the validator covering: valid names, uppercase rejection, underscore rejection, names shorter than 3 chars, names longer than 63 chars
- [x] 2.3 Wire the validator into every bucket-create call site so invalid names are rejected before any backend call

## 3. Source Discovery and workspace_buckets Merge

- [x] 3.1 Implement a `discoverMinIOBuckets()` function in the provisioning orchestrator that lists all buckets from the source MinIO backend using the existing S3 client
- [x] 3.2 Implement `mergeDiscoveredBuckets(discovered, workspaceBuckets)` that returns: buckets with existing rows (no action needed), and buckets with no row (to be inserted)
- [x] 3.3 Implement `insertMissingWorkspaceBucketRows(missing)` that inserts a `workspace_buckets` row for each discovered bucket that lacks one, associating it with the matching workspace by name pattern
- [x] 3.4 Write integration tests for the merge logic using fixture data covering: all buckets have rows, some buckets have no row, no buckets have rows

## 4. Idempotent Bucket Reconciliation Core

- [x] 4.1 Implement `reconcileBucket(bucketName, seaweedfsClient, { dryRun })` in `services/provisioning-orchestrator/src/reconcilers/bucket-reconciler.mjs`: issues `headBucket`; if 404 issues `createBucket`; if already exists, no-ops
- [x] 4.2 Implement `detectNameCollisions(workspaceBucketRows)` that returns any groups of workspace IDs sharing the same sanitized bucket name
- [x] 4.3 Implement the top-level `reconcileAllBuckets(workspaceBuckets, seaweedfsClient, { dryRun })` that: runs collision detection first; skips colliding pairs (logging conflict entries); runs `reconcileBucket` for all remaining rows
- [x] 4.4 Write unit tests verifying idempotency: calling `reconcileAllBuckets` twice with the same input produces the same set of SeaweedFS buckets and the same outcome log
- [x] 4.5 Write unit tests verifying collision detection: colliding buckets are skipped and reported; non-conflicting buckets proceed

## 5. Lifecycle and Config Compatibility Gate

- [x] 5.1 Create `services/provisioning-orchestrator/src/config/seaweedfs-compat-matrix.json` populated from the adr-spike compatibility matrix artifact, keyed by SeaweedFS version with entries for `lifecycle`, `policy`, `cors`, `versioning` each valued `SUPPORTED`, `PARTIAL`, or `UNSUPPORTED`
- [x] 5.2 Implement `applyBucketConfig(bucketName, config, seaweedfsVersion, seaweedfsClient, { dryRun })` that consults the compat matrix and for each config type: calls the corresponding applier method if SUPPORTED; applies the supported subset and logs a `partial` gap entry if PARTIAL; skips and logs a `drop` gap entry if UNSUPPORTED
- [x] 5.3 Wire `applyBucketConfig` into the reconciliation loop after each successful `reconcileBucket` call, passing the detected SeaweedFS version
- [x] 5.4 Write unit tests for the compat gate covering: SUPPORTED path calls the applier; PARTIAL path calls applier with subset and produces a gap entry with omitted fields; UNSUPPORTED path skips applier call and produces a `drop` gap entry
- [x] 5.5 Wire `putBucketLifecycleConfiguration`, `putBucketPolicy`, `putBucketCors`, and `putBucketVersioning` from `services/provisioning-orchestrator/src/appliers/storage-applier.mjs` into `applyBucketConfig` so they are no longer unwired

## 6. Gap Log

- [x] 6.1 Implement `GapLogger` class that accumulates structured entries and writes them as newline-delimited JSON to stdout (or a configurable output stream)
- [x] 6.2 Ensure every `applyBucketConfig` call writes exactly one gap log entry per config type with fields: `bucketName`, `configType`, `seaweedfsVersion`, `decision`, `omittedFields` (for PARTIAL), `reason` (for UNSUPPORTED)
- [x] 6.3 Write a unit test that captures gap log output for a fixture bucket with all four config types set across SUPPORTED/PARTIAL/UNSUPPORTED and asserts the entry count and field values

## 7. Dry-Run Mode

- [x] 7.1 Add a `--dry-run` flag to the reconciliation CLI entry point (`services/provisioning-orchestrator/src/commands/reconcile-buckets.mjs` or equivalent)
- [x] 7.2 Thread `{ dryRun: true }` through `reconcileAllBuckets` and `applyBucketConfig` so all writes are replaced with plan-record calls that accumulate into a dry-run output list
- [x] 7.3 Print the dry-run output list as structured JSON to stdout before exiting with status 0
- [x] 7.4 Write an integration test that invokes the CLI with `--dry-run` against a fixture and asserts: no SeaweedFS write calls were made, output is valid JSON, all expected bucket names appear in the plan

## 8. Prerequisite Check

- [x] 8.1 Implement `checkPrerequisites(seaweedfsClient, config)` that: pings the SeaweedFS endpoint (e.g., `listBuckets` with timeout); verifies required config fields (`endpoint`, `accessKeyId`, `secretAccessKey`) are present and non-empty
- [x] 8.2 Call `checkPrerequisites` as the first step of the reconciliation command; exit with non-zero status and a descriptive error message if any check fails
- [x] 8.3 Write unit tests: unreachable endpoint → exits non-zero with endpoint identified in error; missing credentials → exits non-zero with missing field identified

## 9. Post-Migration Tenant Isolation Enforcement

- [x] 9.1 After all buckets are created and configs applied, implement `enforceIsolationPolicies(workspaceBuckets, seaweedfsClient, { dryRun })` that calls `putBucketPolicy` for each bucket with a policy restricting access to the owning workspace's IAM identity
- [x] 9.2 Implement `verifyIsolation(bucketName, crossTenantCredential, seaweedfsClient)` that issues a `headBucket` with a cross-tenant credential and asserts a 403 response
- [x] 9.3 Write a black-box test that: provisions two tenants (A and B), runs reconciliation, and verifies Tenant B's credential receives 403 when accessing Tenant A's bucket (and vice versa)

## 10. Real-Stack Integration Test

- [x] 10.1 Add a `tests/env` slice that boots a local SeaweedFS instance (or uses the test-env docker-compose SeaweedFS service once deployed) and runs the full reconciliation command against it with a fixture `workspace_buckets` table
- [x] 10.2 Assert: all fixture buckets exist on SeaweedFS after apply; `workspace_buckets` rows are unchanged; gap log is present and machine-readable
- [x] 10.3 Assert idempotency: run the reconciliation command a second time and verify no additional create calls are made and the gap log entries are identical
- [x] 10.4 Run `bash tests/blackbox/run.sh` and confirm no regression in existing storage capability tests
