/** Disposable per-run fixtures through the real public API. LIVE GATE: no offline Storage mocks. */
import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { TENANT_A, TENANT_B, controlPlaneBaseUrl } from '../../helpers/storage/tenant-fixtures'
import { createStorageApiClient } from '../../helpers/storage/storage-api-client'
import type { StorageApiClient } from '../../helpers/storage/storage-api-client'
import { mintTenantToken } from '../../helpers/storage/storage-auth'
import { probeStorageApi, STORAGE_GATE_REASON } from '../../helpers/storage/storage-gate'
import { setupStorageBucket, teardownStorageBucket, withStorageBucket, sweepStorageBuckets } from '../../helpers/storage/storage-bucket-fixture'
import type { StorageBucketHandoff } from '../../helpers/storage/storage-bucket-fixture'
import { fixtureBucketName, serializeFixtureHandoff, FIXTURE_TTL_MS } from '../../helpers/storage/storage-fixture-contract.mjs'

// Provisioning and token responses contain credentials. Never capture them in traces.
test.use({ trace: 'off' })

test.describe('storage: disposable bucket fixture', () => {
  test.setTimeout(300_000)
  let ctx: APIRequestContext
  let client: StorageApiClient
  let other: StorageApiClient
  let anonymous: StorageApiClient
  const pending: StorageBucketHandoff[] = []

  test.beforeAll(async ({ playwright }) => {
    ctx = await playwright.request.newContext()
    test.skip(!process.env.E2E_KC_TOKEN_URL, 'LIVE GATE: E2E_KC_TOKEN_URL is unset; bearer identities unavailable')
    const tokenA = await mintTenantToken(ctx, TENANT_A)
    const tokenB = await mintTenantToken(ctx, TENANT_B)
    test.skip(!tokenA || !tokenB, 'LIVE GATE: tenant A/B bearer grants unavailable')
    const base = controlPlaneBaseUrl()
    const gate = await probeStorageApi(ctx, base, TENANT_A, tokenA)
    test.skip(!gate.available, gate.reason || STORAGE_GATE_REASON)
    client = createStorageApiClient(ctx, base, TENANT_A, tokenA)
    other = createStorageApiClient(ctx, base, TENANT_B, tokenB)
    anonymous = createStorageApiClient(ctx, base, TENANT_A)
  })

  test.afterAll(async () => {
    try {
      // Try every cleanup even if one request fails; surface cleanup errors to the runner.
      const results = await Promise.allSettled(pending.map(h => teardownStorageBucket(client, h)))
      if (results.some(r => r.status === 'rejected')) throw new Error('Storage fixture afterAll cleanup failed')
    } finally {
      await ctx?.dispose()
    }
  })

  async function setup(purpose: string) {
    const handoff = await setupStorageBucket(client, TENANT_A, purpose)
    pending.push(handoff)
    return handoff
  }

  test('setup, byte-faithful object I/O, denial without existence leaks, and idempotent teardown', async () => {
    const handoff = await setup('draft')
    const { bucketId, objectPrefix } = handoff
    const key = `${objectPrefix}incomplete.bin`
    const bytes = Buffer.from([0, 255, 128, 65, 10])
    try {
      expect(Object.keys(JSON.parse(serializeFixtureHandoff(handoff))).sort()).toEqual(['bucketId', 'objectPrefix'])
      expect((await client.putObject(bucketId, key, bytes)).status).toBe(201)
      const read = await client.getObject(bucketId, key)
      expect(read.status).toBe(200)
      expect(Buffer.from(read.body.contentBase64, 'base64').equals(bytes)).toBe(true)
      const list = await client.listObjects(bucketId)
      expect(list.status).toBe(200)
      expect(list.body.items.some((o: { objectKey: string }) => o.objectKey === key)).toBe(true)

      for (const denied of [other, anonymous]) {
        const expectedStatus = denied === other ? 404 : 401
        for (const probe of [
          (id: string) => denied.getObject(id, key),
          (id: string) => denied.putObject(id, key, bytes),
          (id: string) => denied.listObjects(id),
        ]) {
          const existing = await probe(bucketId)
          const missing = await probe('wiki-artifacts')
          expect(existing.status).toBe(expectedStatus)
          expect(missing.status).toBe(expectedStatus)
          // Compare error codes and normalized messages, without printing IDs or response bodies.
          expect(existing.body.code === missing.body.code).toBe(true)
          expect(JSON.stringify(existing.body).replaceAll(bucketId, '<bucket>') ===
            JSON.stringify(missing.body).replaceAll('wiki-artifacts', '<bucket>')).toBe(true)
        }
      }
      expect((await client.getObject('wiki-artifacts', key)).status).toBe(404)
      expect((await client.putObject('wiki-artifacts', key, bytes)).status).toBe(404)
      expect((await client.listObjects('wiki-artifacts')).status).toBe(404)
      expect((await client.deleteObject(bucketId, key)).status).toBe(200)
      expect((await client.getObject(bucketId, key)).status).toBe(404)
    } finally {
      await teardownStorageBucket(client, handoff)
    }
    await teardownStorageBucket(client, handoff)
    const buckets = await client.listBuckets()
    expect(buckets.status).toBe(200)
    expect(buckets.body.items.some((b: { resourceId: string }) => b.resourceId === bucketId)).toBe(false)
    expect((await client.getObject(bucketId, key)).status).toBe(404)
  })

  test('concurrent fixtures and a finally cleanup leave the other run readable', async () => {
    // Register each result immediately, even when its concurrent sibling fails to provision.
    const results = await Promise.allSettled([setup('first'), setup('second')])
    const failure = results.find(r => r.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    const [first, second] = results.map(r => (r as PromiseFulfilledResult<StorageBucketHandoff>).value)
    const bytes = Buffer.from('retained incomplete draft')
    const key = `${second.objectPrefix}draft.txt`
    try {
      expect(first.bucketId === second.bucketId).toBe(false)
      expect((await client.putObject(first.bucketId, key, bytes)).status).toBe(201)
      expect((await client.putObject(second.bucketId, key, bytes)).status).toBe(201)
      await teardownStorageBucket(client, first)
      const read = await client.getObject(second.bucketId, key)
      expect(read.status).toBe(200)
      expect(Buffer.from(read.body.contentBase64, 'base64').equals(bytes)).toBe(true)
    } finally {
      await teardownStorageBucket(client, second)
    }
  })

  test('a failing consumer is cleaned up and the normal sweep preserves a recent fixture', async () => {
    let failed: StorageBucketHandoff | undefined
    await expect(withStorageBucket(client, TENANT_A, 'failure', async h => {
      failed = h
      pending.push(h)
      expect((await client.putObject(h.bucketId, `${h.objectPrefix}partial`, Buffer.from('partial'))).status).toBe(201)
      throw new Error('Deliberate consumer failure')
    })).rejects.toThrow('Deliberate consumer failure')
    expect(Boolean(failed)).toBe(true)
    expect((await client.getObject(failed!.bucketId, `${failed!.objectPrefix}partial`)).status).toBe(404)
    const fresh = await setup('fresh')
    try {
      const swept = await sweepStorageBuckets(client, TENANT_A)
      expect(swept.includes(fresh.bucketId)).toBe(false)
      expect((await client.listObjects(fresh.bucketId)).status).toBe(200)
    } finally {
      await teardownStorageBucket(client, fresh)
    }
  })

  test('sweep removes an expired fixture but preserves a recent run and a non-prefixed bucket', async () => {
    const control = await client.provisionBucket(TENANT_A.workspaceId, fixtureBucketName('control').replace(/^e2e-/, 'control-'))
    const controlHandoff = control.body.bucket?.resourceId
      ? { bucketId: control.body.bucket.resourceId, objectPrefix: 'artifacts/' } : undefined
    if (controlHandoff) pending.push(controlHandoff)
    expect(control.status).toBe(201)
    expect(Boolean(controlHandoff)).toBe(true)
    const stale = await setup('sweep')
    const before = await client.listBuckets()
    expect(before.status).toBe(200)
    const created = Date.parse(before.body.items.find((b: { resourceId: string }) => b.resourceId === stale.bucketId)?.timestamps?.createdAt)
    expect(Number.isFinite(created)).toBe(true)
    // Separate server timestamps without changing any backend data.
    await new Promise(resolve => setTimeout(resolve, 1100))
    const fresh = await setup('sweep-peer')
    const key = `${fresh.objectPrefix}retained`
    try {
      expect((await client.putObject(stale.bucketId, key, Buffer.from('stale'))).status).toBe(201)
      expect((await client.putObject(fresh.bucketId, key, Buffer.from('fresh'))).status).toBe(201)
      // A clock probe restricted to this test's three handoffs cannot sweep another run.
      const removed = await sweepStorageBuckets(client, TENANT_A, {
        now: created + FIXTURE_TTL_MS + 1,
        onlyBucketIds: [stale.bucketId, fresh.bucketId, controlHandoff!.bucketId],
      })
      expect(removed.length).toBe(1)
      expect(removed[0] === stale.bucketId).toBe(true)
      expect((await client.getObject(stale.bucketId, key)).status).toBe(404)
      expect((await client.getObject(fresh.bucketId, key)).status).toBe(200)
      expect((await client.listObjects(controlHandoff!.bucketId)).status).toBe(200)
      const after = await client.listBuckets()
      expect(after.status).toBe(200)
      expect(after.body.items.some((b: { resourceId: string }) => b.resourceId === stale.bucketId)).toBe(false)
    } finally {
      await Promise.all([
        teardownStorageBucket(client, stale), teardownStorageBucket(client, fresh),
        teardownStorageBucket(client, controlHandoff!),
      ])
    }
  })
})
