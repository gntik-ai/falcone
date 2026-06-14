/**
 * Two-tenant fixtures for the Storage E2E suite (change: add-seaweedfs-storage-e2e).
 *
 * Re-exports the canonical A/B tenant identities from the flows fixture file so all
 * suites share the SAME fixed UUIDs — no duplication, no UUID drift. Tenant B is used
 * ONLY for cross-tenant isolation probes: B must never see A's buckets or objects.
 *
 * Identity values are FIXED (not random) so idempotent re-runs do not accumulate stale rows
 * (the storage workspace_buckets table is tenant_id-scoped).
 *
 * Covered by: STO-E2E-001..005, STO-E2E-XT-01..03
 * fn coverage: fn-storage-list-buckets, fn-storage-provision-bucket,
 *              fn-storage-workspace-usage, fn-storage-list-objects,
 *              fn-storage-object-metadata, fn-storage-tenant-isolation
 */

export {
  TENANT_A,
  TENANT_B,
  controlPlaneBaseUrl,
} from '../flows/tenant-fixtures'

/**
 * Generate a deterministic, DNS-safe bucket name for a given test scenario label.
 * Bucket names must match /^[a-z0-9-]{3,63}$/ (the rule enforced by storageProvisionBucket).
 * Stable across re-runs; no accumulation of stale buckets.
 */
export function bucketName(scenario: string): string {
  return `e2e-sto-${scenario.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)}`
}
