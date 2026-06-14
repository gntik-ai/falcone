/**
 * Per-issue storage E2E runner — change: add-seaweedfs-storage-e2e.
 *
 * Entry point for `bash tests/e2e/run-issue.sh add-seaweedfs-storage-e2e`.
 *
 * Re-exports all storage spec describe blocks so that a single Playwright run exercises
 * the full storage suite: list-buckets, provision-bucket, workspace-usage, list-objects,
 * object-metadata, and cross-tenant isolation. The full suite also lives under
 * `specs/storage/` and is run by `run.sh` as part of the normal E2E sweep.
 *
 * All specs carry a live-gate (`probeStorageApi`) that skips gracefully when:
 *   - The stack is not running (no kind cluster / port-forward).
 *   - The storage routes are not wired in the live control-plane.
 *   - The SeaweedFS backend is not deployed (requires E2E_STORAGE_BACKEND=seaweedfs).
 *
 * fn coverage (all five wired storage routes + cross-tenant isolation):
 *   fn-storage-list-buckets, fn-storage-provision-bucket, fn-storage-workspace-usage,
 *   fn-storage-list-objects, fn-storage-object-metadata, fn-storage-tenant-isolation
 *
 * Referenced scenarios: STO-E2E-001, STO-E2E-002, STO-E2E-003, STO-E2E-004,
 *                       STO-E2E-005, STO-E2E-XT-01, STO-E2E-XT-02, STO-E2E-XT-03
 */

// Re-import each spec module. Playwright discovers test.describe blocks declared at module
// scope across imports when the file is loaded as a test entry point.
import '../storage/storage-list-buckets.spec'
import '../storage/storage-provision-bucket.spec'
import '../storage/storage-workspace-usage.spec'
import '../storage/storage-list-objects.spec'
import '../storage/storage-object-metadata.spec'
import '../storage/storage-cross-tenant.spec'
