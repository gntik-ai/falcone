/**
 * Storage E2E — Scenario STO-E2E-001: List buckets (change: add-seaweedfs-storage-e2e).
 *
 * User story: us-storage-01 — As a developer I want to list all storage buckets in my
 * tenant so that I can see which buckets are available to my workspace.
 *
 * Acceptance criteria exercised:
 *   - GET /v1/storage/buckets returns HTTP 200 for an authenticated Tenant A request.
 *   - The response body contains `items` (an array, possibly empty) and a `page` descriptor.
 *
 * fn coverage: fn-storage-list-buckets
 * Linked: STO-E2E-001, add-seaweedfs-storage-e2e
 *
 * LIVE GATE: skips with a precise reason when the storage API is not served or the
 * SeaweedFS backend is not running (see storage-gate.ts).
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, controlPlaneBaseUrl } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient, StorageApiClient } from '../../helpers/storage/storage-api-client'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'

test.describe('storage: list buckets', () => {
  test.describe.configure({ mode: 'serial' })

  let ctx: APIRequestContext
  let client: StorageApiClient
  const cpBase = controlPlaneBaseUrl()

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext({ baseURL: cpBase })
    const gate = await probeStorageApi(ctx, cpBase, TENANT_A)
    test.skip(!gate.available, gate.reason || STORAGE_GATE_REASON)
    client = createStorageApiClient(ctx, cpBase, TENANT_A)
  })

  test.afterAll(async () => {
    await ctx?.dispose()
  })

  test('sto-e2e-001: GET /v1/storage/buckets returns 200 with an items array', async () => {
    const res = await client.listBuckets()
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(typeof res.body.page).toBe('object')
    expect(typeof res.body.page.size).toBe('number')
  })
})
