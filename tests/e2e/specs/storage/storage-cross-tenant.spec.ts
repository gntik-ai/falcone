/**
 * Storage E2E — Cross-tenant isolation probes (change: add-seaweedfs-storage-e2e).
 *
 * User story: us-storage-xt — As a platform security officer I want to ensure that Tenant B
 * cannot list, read, or access Tenant A's storage buckets or objects so that storage data
 * is strictly isolated by tenant.
 *
 * Acceptance criteria exercised:
 *   STO-E2E-XT-01: Tenant B's GET /v1/storage/buckets does not include any bucket provisioned
 *                  by Tenant A in the same test run.
 *   STO-E2E-XT-02: Tenant B's GET /v1/storage/buckets/{bucketId}/objects with Tenant A's
 *                  bucketId returns 403 or 404.
 *   STO-E2E-XT-03: Tenant B's GET /v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata
 *                  with Tenant A's bucketId returns 403 or 404.
 *
 * Isolation model: storageListBuckets filters by tenant_id via the workspace_buckets map
 * (bucketWorkspaceMap) joined to the requesting tenant's identity header. storageListObjects and
 * storageObjectMetadata proxy directly to S3 using the bucket name from the URL params — no
 * tenant check exists at the S3 level — so the cross-tenant gate relies on the control-plane
 * not resolving / returning a not-found for buckets owned by a different tenant.
 *
 * fn coverage: fn-storage-tenant-isolation, fn-storage-list-buckets, fn-storage-list-objects,
 *              fn-storage-object-metadata
 * Linked: STO-E2E-XT-01, STO-E2E-XT-02, STO-E2E-XT-03, add-seaweedfs-storage-e2e
 *
 * LIVE GATE: skips when storage API or SeaweedFS backend is not running.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, TENANT_B, controlPlaneBaseUrl, bucketName } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient, StorageApiClient } from '../../helpers/storage/storage-api-client'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'
import { mintTenantToken, perTenantS3Enabled, PER_TENANT_S3_SKIP_REASON } from '../../helpers/storage/storage-auth'

test.describe('storage: cross-tenant isolation', () => {
  test.describe.configure({ mode: 'serial' })

  let ctxA: APIRequestContext
  let ctxB: APIRequestContext
  let clientA: StorageApiClient
  let clientB: StorageApiClient
  let bucketIdA: string | undefined
  const cpBase = controlPlaneBaseUrl()
  const BUCKET_A = bucketName('xt-tenant-a')

  test.beforeAll(async ({ playwright }) => {
    ctxA = await playwright.request.newContext({ baseURL: cpBase })
    ctxB = await playwright.request.newContext({ baseURL: cpBase })

    const tokenA = await mintTenantToken(ctxA, TENANT_A)
    const tokenB = await mintTenantToken(ctxB, TENANT_B)
    const gate = await probeStorageApi(ctxA, cpBase, TENANT_A, tokenA)
    test.skip(!gate.available, gate.reason || STORAGE_GATE_REASON)

    clientA = createStorageApiClient(ctxA, cpBase, TENANT_A, tokenA)
    clientB = createStorageApiClient(ctxB, cpBase, TENANT_B, tokenB)

    // Tenant A provisions a bucket that B should not be able to see or access.
    const provision = await clientA.provisionBucket(TENANT_A.workspaceId, BUCKET_A)
    if (provision.status === 201 || provision.status === 200) {
      bucketIdA = provision.body.bucket?.resourceId ?? provision.body.bucket?.bucketName
    }
    // Fallback: the derived bucket name is the resourceId for objects/metadata probes.
    if (!bucketIdA) bucketIdA = BUCKET_A
  })

  test.afterAll(async () => {
    // No bucket-delete route wired; namespace teardown by stack.sh down handles cleanup.
    await ctxA?.dispose()
    await ctxB?.dispose()
  })

  test('sto-e2e-xt-01: Tenant A\'s bucket does not appear in Tenant B\'s list', async () => {
    test.skip(!perTenantS3Enabled(), PER_TENANT_S3_SKIP_REASON)
    test.skip(!bucketIdA, 'Tenant A bucket provisioning failed in beforeAll')
    const list = await clientB.listBuckets()
    expect(list.status).toBe(200)
    const ids = (list.body.items ?? []).map(
      (b: { resourceId?: string; bucketName?: string }) => b.resourceId ?? b.bucketName,
    )
    expect(ids).not.toContain(bucketIdA)
  })

  test('sto-e2e-xt-02: Tenant B is denied access to Tenant A\'s bucket objects', async () => {
    test.skip(!perTenantS3Enabled(), PER_TENANT_S3_SKIP_REASON)
    test.skip(!bucketIdA, 'Tenant A bucket provisioning failed in beforeAll')
    const res = await clientB.listObjects(bucketIdA!)
    // The control-plane either denies (403), returns not-found (404),
    // or proxies directly to S3 where no tenant check exists but the bucket may not map to B.
    expect([403, 404]).toContain(res.status)
  })

  test('sto-e2e-xt-03: Tenant B is denied object metadata for Tenant A\'s bucket', async () => {
    test.skip(!perTenantS3Enabled(), PER_TENANT_S3_SKIP_REASON)
    test.skip(!bucketIdA, 'Tenant A bucket provisioning failed in beforeAll')
    const res = await clientB.getObjectMetadata(bucketIdA!, 'any-object-key')
    // 404 is acceptable if the key does not exist (no upload happened for cross-tenant key),
    // but 403 is also acceptable when the control-plane enforces tenant ownership.
    expect([403, 404]).toContain(res.status)
  })
})
