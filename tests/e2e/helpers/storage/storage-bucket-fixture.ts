import type { StorageApiClient, TenantIdentity } from './storage-api-client'
import { fixtureBucketName, fixtureHandoff, isStaleFixtureBucket, FIXTURE_TTL_MS } from './storage-fixture-contract.mjs'

export interface StorageBucketHandoff {
  bucketId: string
  /** Relative object-key prefix; contains no tenant/workspace IDs or credentials. */
  objectPrefix: string
}

/** Use a trace-disabled, standalone request context; never attach the provision response. */
export async function setupStorageBucket(
  client: StorageApiClient, identity: TenantIdentity, purpose: string,
): Promise<StorageBucketHandoff> {
  const provision = await client.provisionBucket(identity.workspaceId, fixtureBucketName(purpose))
  if (provision.status !== 201) {
    // Do not interpolate the response, which may contain credentials or identity details.
    const reason = provision.status === 403 ? 'bucket.admin is required'
      : provision.status === 409 ? 'STORAGE_QUOTA_EXCEEDED or bucket conflict; check workspace quota'
        : 'expected HTTP 201'
    throw new Error(`Storage fixture setup failed: HTTP ${provision.status}; ${reason}`)
  }
  return fixtureHandoff(provision.body)
}

/** Delete only this handoff's objects and bucket. Already-absent resources are successful. */
export async function teardownStorageBucket(client: StorageApiClient, handoff: StorageBucketHandoff): Promise<void> {
  let after: string | undefined
  const seen = new Set<string>()
  do {
    const list = await client.listObjects(handoff.bucketId, after)
    if (list.status === 404) break
    if (list.status !== 200 || !Array.isArray(list.body.items)) {
      throw new Error(`Storage fixture object listing failed: HTTP ${list.status}`)
    }
    for (const object of list.body.items) {
      if (typeof object.objectKey !== 'string') throw new Error('Storage fixture listing has no object key')
      const removed = await client.deleteObject(handoff.bucketId, object.objectKey)
      if (![200, 204, 404].includes(removed.status)) throw new Error(`Storage fixture object cleanup failed: HTTP ${removed.status}`)
    }
    after = list.body.page?.nextCursor
    if (after) {
      if (typeof after !== 'string' || seen.has(after) || seen.size >= 1000) throw new Error('Storage fixture pagination did not terminate')
      seen.add(after)
    }
  } while (after)
  const removed = await client.deleteBucket(handoff.bucketId)
  if (![200, 204, 404].includes(removed.status)) throw new Error(`Storage fixture bucket cleanup failed: HTTP ${removed.status}`)
}

export async function withStorageBucket<T>(
  client: StorageApiClient, identity: TenantIdentity, purpose: string,
  consumer: (handoff: StorageBucketHandoff) => Promise<T>,
): Promise<T> {
  const handoff = await setupStorageBucket(client, identity, purpose)
  try {
    return await consumer(handoff)
  } finally {
    await teardownStorageBucket(client, handoff)
  }
}

/** Explicit operator action, never a suite-start hook. Only the caller's stale fixtures qualify. */
export async function sweepStorageBuckets(
  client: StorageApiClient, identity: TenantIdentity,
  { ttlMs = FIXTURE_TTL_MS, now = Date.now(), onlyBucketIds }: {
    ttlMs?: number; now?: number; onlyBucketIds?: readonly string[]
  } = {},
): Promise<string[]> {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isFinite(now)) throw new Error('Invalid fixture TTL or clock')
  const list = await client.listBuckets()
  if (list.status !== 200 || !Array.isArray(list.body.items)) throw new Error(`Storage fixture sweep listing failed: HTTP ${list.status}`)
  const removed: string[] = []
  for (const bucket of list.body.items) {
    if (!isStaleFixtureBucket(bucket, identity, { ttlMs, now, onlyBucketIds: onlyBucketIds ?? null })) continue
    await teardownStorageBucket(client, { bucketId: bucket.resourceId, objectPrefix: 'artifacts/' })
    removed.push(bucket.resourceId)
  }
  return removed
}
