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
import { TENANT_A, controlPlaneBaseUrl } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient, StorageApiClient } from '../../helpers/storage/storage-api-client'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'
import { mintTenantToken } from '../../helpers/storage/storage-auth'
import { fixtureBucketName } from '../../helpers/storage/storage-fixture-contract.mjs'
import { teardownStorageBucket } from '../../helpers/storage/storage-bucket-fixture'

test.use({ trace: 'off' })

test.describe('storage: provision bucket', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(300_000)

  let ctx: APIRequestContext
  let client: StorageApiClient
  let provisionedBucketId: string | undefined
  const cpBase = controlPlaneBaseUrl()
  const BUCKET = fixtureBucketName('provision-002')

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const token = await mintTenantToken(ctx, TENANT_A)
    test.skip(!token, 'LIVE GATE: tenant bearer grant unavailable')
    const gate = await probeStorageApi(ctx, cpBase, TENANT_A, token)
    test.skip(!gate.available, gate.reason || STORAGE_GATE_REASON)
    client = createStorageApiClient(ctx, cpBase, TENANT_A, token)
  })

  test.afterAll(async () => {
    try {
      if (provisionedBucketId) await teardownStorageBucket(client, { bucketId: provisionedBucketId, objectPrefix: 'artifacts/' })
    } finally {
      await ctx?.dispose()
    }
  })

  test('sto-e2e-002a: POST /v1/storage/workspaces/{workspaceId}/buckets returns 201', async () => {
    const res = await client.provisionBucket(TENANT_A.workspaceId, BUCKET)
    provisionedBucketId = res.body.bucket?.resourceId
    if (res.status === 403) throw new Error('Storage fixture setup denied: HTTP 403; bucket.admin is required')
    if (res.status === 409) throw new Error('Storage fixture setup denied: HTTP 409; STORAGE_QUOTA_EXCEEDED or bucket conflict')
    expect(res.status).toBe(201)
    expect(res.body.bucket).toBeDefined()
    expect(typeof res.body.bucket.resourceId).toBe('string')
    expect(typeof res.body.bucket.bucketName).toBe('string')
  })

  test('sto-e2e-002b: provisioned bucket appears in listBuckets', async () => {
    // Require the bucket to have been provisioned by the previous step.
    test.skip(!provisionedBucketId, 'provision step did not complete — bucket ID not set')
    const list = await client.listBuckets()
    expect(list.status).toBe(200)
    expect((list.body.items ?? []).some(
      (b: { resourceId?: string }) => b.resourceId === provisionedBucketId,
    )).toBe(true)
  })
})
