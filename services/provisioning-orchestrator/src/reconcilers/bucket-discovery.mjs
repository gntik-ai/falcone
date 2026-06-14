/**
 * Source-bucket discovery + workspace_buckets backfill for the SeaweedFS
 * migration. The `workspace_buckets` table is the canonical mapping, but a bucket
 * may exist on the source MinIO backend with no corresponding row (legacy
 * out-of-band creation). Discovery lists the source, merges against the table,
 * and backfills rows for the orphans before reconciliation runs.
 *
 * @module reconcilers/bucket-discovery
 */

/**
 * List every bucket on the source MinIO backend using the existing S3 client.
 * Tolerates both the AWS-SDK shape (`{ Buckets: [{ Name }] }`) and a plain array
 * of names.
 *
 * @param {object} sourceClient - S3 client exposing `listBuckets()`
 * @returns {Promise<string[]>} bucket names
 */
export async function discoverMinIOBuckets(sourceClient) {
  if (!sourceClient || typeof sourceClient.listBuckets !== 'function') {
    throw new Error('discoverMinIOBuckets requires a source S3 client with listBuckets()');
  }
  const res = await sourceClient.listBuckets();
  const list = Array.isArray(res) ? res : res?.Buckets ?? res?.buckets ?? [];
  return list
    .map((b) => (typeof b === 'string' ? b : b?.Name ?? b?.name))
    .filter((name) => typeof name === 'string' && name.length > 0);
}

/**
 * Partition discovered buckets into those that already have a `workspace_buckets`
 * row (no action) and those that do not (to be inserted).
 *
 * @param {string[]} discovered - bucket names from {@link discoverMinIOBuckets}
 * @param {Array<{ bucket_name: string }>} workspaceBuckets - rows from workspace_buckets
 * @returns {{ existing: Array<{bucketName:string, row:object}>, missing: Array<{bucketName:string}> }}
 */
export function mergeDiscoveredBuckets(discovered, workspaceBuckets) {
  const rowByName = new Map();
  for (const row of workspaceBuckets ?? []) {
    if (row && typeof row.bucket_name === 'string') rowByName.set(row.bucket_name, row);
  }
  const existing = [];
  const missing = [];
  for (const name of discovered ?? []) {
    if (rowByName.has(name)) existing.push({ bucketName: name, row: rowByName.get(name) });
    else missing.push({ bucketName: name });
  }
  return { existing, missing };
}

/**
 * Insert a `workspace_buckets` row for each discovered bucket lacking one,
 * associating it with the matching workspace via the injected `associate`
 * resolver (name-pattern → { workspaceId, tenantId, region }). Buckets that
 * cannot be associated are skipped-and-reported, never guessed. Idempotent via
 * `ON CONFLICT (bucket_name) DO NOTHING`.
 *
 * @param {Array<{bucketName:string}|string>} missing
 * @param {Object} opts
 * @param {{ query: Function }} [opts.pool] - pg pool (omit for a pure plan)
 * @param {(bucketName:string)=>({workspaceId:string,tenantId:string,region?:string}|null)} opts.associate
 * @returns {Promise<{ inserted: object[], skipped: object[] }>}
 */
export async function insertMissingWorkspaceBucketRows(missing, opts = {}) {
  const { pool = null, associate } = opts;
  if (typeof associate !== 'function') {
    throw new Error('insertMissingWorkspaceBucketRows requires an associate(bucketName) resolver');
  }
  const inserted = [];
  const skipped = [];
  for (const item of missing ?? []) {
    const name = typeof item === 'string' ? item : item?.bucketName;
    if (!name) continue;
    const assoc = associate(name);
    if (!assoc || !assoc.workspaceId || !assoc.tenantId) {
      skipped.push({ bucketName: name, reason: 'no workspace association' });
      continue;
    }
    const region = assoc.region ?? 'us-east-1';
    if (pool && typeof pool.query === 'function') {
      await pool.query(
        `INSERT INTO workspace_buckets (workspace_id, tenant_id, bucket_name, region)
         VALUES ($1, $2, $3, $4) ON CONFLICT (bucket_name) DO NOTHING`,
        [assoc.workspaceId, assoc.tenantId, name, region],
      );
    }
    inserted.push({ bucketName: name, workspaceId: assoc.workspaceId, tenantId: assoc.tenantId, region });
  }
  return { inserted, skipped };
}
