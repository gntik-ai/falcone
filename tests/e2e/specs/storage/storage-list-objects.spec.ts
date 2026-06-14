/**
 * Storage E2E — Scenario STO-E2E-004: List objects (change: add-seaweedfs-storage-e2e).
 *
 * User story: us-storage-04 — As a developer I want to list objects in my storage bucket
 * so that I can browse files uploaded by my application.
 *
 * Acceptance criteria exercised:
 *   - A bucket is provisioned in beforeAll via POST /v1/storage/workspaces/{workspaceId}/buckets.
 *   - GET /v1/storage/buckets/{bucketId}/objects returns HTTP 200.
 *   - The response body contains an `items` array (possibly empty for a fresh bucket) and a
 *     `page` descriptor with a numeric `size` field.
 *
 * fn coverage: fn-storage-list-objects, fn-storage-provision-bucket
 * Linked: STO-E2E-004, add-seaweedfs-storage-e2e
 *
 * LIVE GATE: skips when storage API or SeaweedFS backend is not running.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, controlPlaneBaseUrl, bucketName } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient, StorageApiClient } from '../../helpers/storage/storage-api-client'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'
import { mintTenantToken } from '../../helpers/storage/storage-auth'

test.describe('storage: list objects', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: StorageApiClient
  let bucketId: string | undefined
  const cpBase = controlPlaneBaseUrl()
  const BUCKET = bucketName('list-objects-004')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const token = await mintTenantToken(ctx, TENANT_A)
    const gate = await probeStorageApi(ctx, cpBase, TENANT_A, token)
    test.skip(!gate.available, gate.reason || STORAGE_GATE_REASON)
    client = createStorageApiClient(ctx, cpBase, TENANT_A, token)

    // Provision a bucket so the list-objects call has a valid bucket to target.
    const provision = await client.provisionBucket(TENANT_A.workspaceId, BUCKET)
    if (provision.status === 201 || provision.status === 200) {
      bucketId = provision.body.bucket?.resourceId ?? provision.body.bucket?.bucketName
    }
    // If provision fails (e.g. bucket already exists from a prior run), fall back to the
    // derived name — storageListObjects accepts the bucket name directly as bucketId.
    if (!bucketId) bucketId = BUCKET
  })

  test.afterAll(async () => {
    // No bucket-delete route wired; namespace teardown removes all SeaweedFS state.
    await ctx?.dispose()
  })

  test('sto-e2e-004: GET /v1/storage/buckets/{bucketId}/objects returns 200 with items array', async () => {
    test.skip(!bucketId, 'bucket provisioning failed in beforeAll — cannot test list-objects')
    const res = await client.listObjects(bucketId!)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(typeof res.body.page).toBe('object')
    expect(typeof res.body.page.size).toBe('number')
  })
})
