/**
 * Storage E2E — Scenario STO-E2E-003: Workspace usage (change: add-seaweedfs-storage-e2e).
 *
 * User story: us-storage-03 — As a developer I want to see how much storage my workspace
 * is consuming so that I can monitor quota utilization.
 *
 * Acceptance criteria exercised:
 *   - GET /v1/storage/workspaces/{workspaceId}/usage returns HTTP 200.
 *   - The response body contains a `dimensions` object with `totalBytes`, `bucketCount`,
 *     `objectCount`, and `objectSizeBytes` dimension entries (handler shape verified against
 *     deploy/kind/control-plane/storage-handlers.mjs storageWorkspaceUsage).
 *   - Each dimension entry has a numeric `used` field.
 *
 * fn coverage: fn-storage-workspace-usage
 * Linked: STO-E2E-003, add-seaweedfs-storage-e2e
 *
 * LIVE GATE: skips when storage API or SeaweedFS backend is not running.
 */

import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, controlPlaneBaseUrl } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient, StorageApiClient } from '../../helpers/storage/storage-api-client'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'

test.describe('storage: workspace usage', () => {
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

  test('sto-e2e-003: GET /v1/storage/workspaces/{workspaceId}/usage returns 200 with usage dimensions', async () => {
    const res = await client.getWorkspaceUsage(TENANT_A.workspaceId)
    expect(res.status).toBe(200)
    // The handler returns a `dimensions` map with at minimum totalBytes, bucketCount,
    // objectCount, objectSizeBytes (storage-handlers.mjs storageWorkspaceUsage).
    expect(typeof res.body.dimensions).toBe('object')
    for (const key of ['totalBytes', 'bucketCount', 'objectCount', 'objectSizeBytes']) {
      expect(res.body.dimensions[key]).toBeDefined()
      expect(typeof res.body.dimensions[key].used).toBe('number')
    }
    // buckets is an array (possibly empty for a fresh workspace).
    expect(Array.isArray(res.body.buckets)).toBe(true)
  })
})
