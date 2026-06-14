/**
 * Storage E2E — Scenario STO-E2E-002: Provision bucket (change: add-seaweedfs-storage-e2e).
 *
 * User story: us-storage-02 — As a developer I want to create a new bucket for my workspace
 * so that I can store files for my application.
 *
 * Acceptance criteria exercised:
 *   - POST /v1/storage/workspaces/{workspaceId}/buckets returns 201.
 *   - The response body contains `bucket.resourceId` and `bucket.bucketName`.
 *   - The provisioned bucket subsequently appears in GET /v1/storage/buckets (items list).
 *
 * fn coverage: fn-storage-provision-bucket, fn-storage-list-buckets
 * Linked: STO-E2E-002, add-seaweedfs-storage-e2e
 *
 * LIVE GATE: skips when storage API or SeaweedFS backend is not running.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, controlPlaneBaseUrl, bucketName } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient, StorageApiClient } from '../../helpers/storage/storage-api-client'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'

test.describe('storage: provision bucket', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: StorageApiClient
  let provisionedBucketId: string | undefined
  const cpBase = controlPlaneBaseUrl()
  const BUCKET = bucketName('provision-002')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeStorageApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || STORAGE_GATE_REASON)
    client = createStorageApiClient(ctx, cpBase, TENANT_A)
  })

  test.afterAll(async () => {
    // No bucket-delete route is wired; SeaweedFS and the namespace are torn down by stack.sh down.
    await ctx?.dispose()
  })

  test('sto-e2e-002a: POST /v1/storage/workspaces/{workspaceId}/buckets returns 201', async () => {
    const res = await client.provisionBucket(TENANT_A.workspaceId, BUCKET)
    expect(res.status).toBe(201)
    expect(res.body.bucket).toBeDefined()
    expect(typeof res.body.bucket.resourceId).toBe('string')
    expect(typeof res.body.bucket.bucketName).toBe('string')
    provisionedBucketId = res.body.bucket.resourceId ?? res.body.bucket.bucketName
  })

  test('sto-e2e-002b: provisioned bucket appears in listBuckets', async () => {
    // Require the bucket to have been provisioned by the previous step.
    test.skip(!provisionedBucketId, 'provision step did not complete — bucket ID not set')
    const list = await client.listBuckets()
    expect(list.status).toBe(200)
    const ids = (list.body.items ?? []).map(
      (b: { resourceId?: string; bucketName?: string }) => b.resourceId ?? b.bucketName,
    )
    expect(ids).toContain(provisionedBucketId)
  })
})
