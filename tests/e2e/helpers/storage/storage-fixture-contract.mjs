import { randomBytes } from 'node:crypto';

/** Requested name, including the run ID, fits the API's 40-character name fragment. */
export function fixtureBucketName(purpose) {
  const label = String(purpose).toLowerCase().replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 15).replace(/-+$/g, '') || 'fixture';
  return `e2e-${label}-${randomBytes(10).toString('hex')}`;
}

/** Project instead of deleting known secrets: future response fields stay private too. */
export function fixtureHandoff(provisionResponse) {
  const bucketId = provisionResponse?.bucket?.resourceId;
  if (typeof bucketId !== 'string' || !bucketId) throw new Error('Fixture provision response has no bucket.resourceId');
  return { bucketId, objectPrefix: 'artifacts/' };
}

/** Serialize a provision response or an existing handoff using the same strict allowlist. */
export function serializeFixtureHandoff(value) {
  return JSON.stringify(fixtureHandoff({ bucket: { resourceId: value?.bucketId ?? value?.bucket?.resourceId } }));
}

export const FIXTURE_TTL_MS = 24 * 60 * 60 * 1000;

/** Fail closed on foreign scope, unknown names, missing dates, and invalid TTLs. */
export function isStaleFixtureBucket(bucket, identity, { now = Date.now(), ttlMs = FIXTURE_TTL_MS, onlyBucketIds = null } = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || !Number.isFinite(now)) throw new Error('Invalid fixture TTL or clock');
  const created = Date.parse(bucket?.timestamps?.createdAt);
  return Boolean(identity?.workspaceId && identity?.tenantId
    && bucket?.workspaceId === identity.workspaceId && bucket?.tenantId === identity.tenantId
    && (onlyBucketIds === null || onlyBucketIds.includes(bucket?.resourceId))
    && /^ws-[a-f0-9]{12}-e2e-[a-z0-9][a-z0-9-]{0,14}-[a-f0-9]{20}$/.test(bucket?.resourceId)
    && Number.isFinite(created) && now - created > ttlMs);
}
