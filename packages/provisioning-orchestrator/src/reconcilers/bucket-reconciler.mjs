/**
 * Idempotent SeaweedFS bucket reconciliation from the canonical `workspace_buckets`
 * source of truth (add-seaweedfs-bucket-lifecycle-migration).
 *
 * - HEAD-then-create per bucket (idempotent re-runs never duplicate).
 * - DNS-name collisions are detected up front; colliding pairs are skipped+reported
 *   while every non-conflicting bucket still reconciles.
 * - Declared lifecycle/policy/CORS/versioning settings flow through the
 *   compatibility gate, which records an explicit gap entry for every decision.
 * - Post-create, per-tenant isolation policies are enforced and verifiable.
 *
 * The SeaweedFS client is injected and follows the s3Api shape used by the
 * existing storage-applier: method-per-operation, each `(bucketName, payload?)`.
 *
 * @module reconcilers/bucket-reconciler
 */

import {
  assertValidBucketName,
  sanitizeBucketName,
} from '../utils/bucket-name-validator.mjs';
import { applyBucketConfig, normalizeSeaweedfsPolicyPrincipal } from './compat-gate.mjs';

/** True when an error from `headBucket` means "bucket does not exist" (404). */
function isNotFound(err) {
  const status = err?.statusCode ?? err?.$metadata?.httpStatusCode ?? err?.status;
  if (status === 404) return true;
  if (status && status !== 404) return false; // a definite non-404 status is a real error
  const marker = String(err?.code ?? err?.name ?? err?.message ?? '');
  return /NotFound|NoSuchBucket|404/i.test(marker);
}

/** Promise timeout helper (used by prerequisite probe). */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label ?? 'operation'} timed out after ${ms}ms`)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Typed error raised when a precondition for reconciliation is not met. */
export class PrerequisiteError extends Error {
  constructor(message, { field, endpoint } = {}) {
    super(message);
    this.name = 'PrerequisiteError';
    this.code = 'PREREQUISITE_FAILED';
    if (field) this.field = field;
    if (endpoint) this.endpoint = endpoint;
  }
}

/** Typed error raised when a cross-tenant probe is NOT denied. */
export class IsolationViolationError extends Error {
  constructor(bucketName) {
    super(`Cross-tenant access to bucket '${bucketName}' was not denied (expected 403)`);
    this.name = 'IsolationViolationError';
    this.code = 'ISOLATION_VIOLATION';
    this.bucketName = bucketName;
  }
}

/**
 * Reconcile a single bucket: HEAD it; create only if absent (404). An existing
 * bucket is left untouched. Names are validated before any backend call.
 *
 * @param {string} bucketName
 * @param {object} seaweedfsClient
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{ bucketName: string, action: ('exists'|'created'|'would_create') }>}
 */
export async function reconcileBucket(bucketName, seaweedfsClient, opts = {}) {
  const { dryRun = false } = opts;
  assertValidBucketName(bucketName);

  let exists = false;
  try {
    await seaweedfsClient.headBucket(bucketName);
    exists = true;
  } catch (err) {
    if (!isNotFound(err)) throw err; // a real error (5xx / network) must not be masked as "create"
    exists = false;
  }

  if (exists) return { bucketName, action: 'exists' };
  if (dryRun) return { bucketName, action: 'would_create' };
  await seaweedfsClient.createBucket(bucketName);
  return { bucketName, action: 'created' };
}

/**
 * Detect groups of workspaces whose bucket names collapse to the same
 * DNS-sanitized name.
 *
 * @param {Array<{ workspace_id: string, bucket_name: string }>} workspaceBucketRows
 * @returns {Array<{ bucketName: string, workspaceIds: string[] }>}
 */
export function detectNameCollisions(workspaceBucketRows) {
  const byName = new Map();
  for (const row of workspaceBucketRows ?? []) {
    const sanitized = sanitizeBucketName(row.bucket_name);
    const list = byName.get(sanitized) ?? [];
    if (!list.includes(row.workspace_id)) list.push(row.workspace_id);
    byName.set(sanitized, list);
  }
  const collisions = [];
  for (const [bucketName, workspaceIds] of byName) {
    if (workspaceIds.length >= 2) collisions.push({ bucketName, workspaceIds });
  }
  return collisions;
}

/**
 * Reconcile all workspace buckets. Collision detection runs first; colliding
 * buckets are skipped+reported, all others are created (idempotently) and their
 * declared config is applied through the compatibility gate.
 *
 * @param {Array<{ workspace_id: string, tenant_id: string, bucket_name: string, region?: string, config?: object }>} workspaceBuckets
 * @param {object} seaweedfsClient
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun=false]
 * @param {string} [opts.seaweedfsVersion]
 * @param {object} [opts.matrix]
 * @param {import('./gap-logger.mjs').GapLogger} [opts.gapLogger]
 * @returns {Promise<{ outcomes: object[], conflicts: object[], created: string[], existing: string[], configResults: object[] }>}
 */
export async function reconcileAllBuckets(workspaceBuckets, seaweedfsClient, opts = {}) {
  const { dryRun = false, seaweedfsVersion, matrix, gapLogger = null } = opts;
  const rows = workspaceBuckets ?? [];

  const collisions = detectNameCollisions(rows);
  const collidingNames = new Set(collisions.map((c) => c.bucketName));

  const conflicts = collisions.map((c) => ({
    type: 'conflict',
    bucketName: c.bucketName,
    workspaceIds: c.workspaceIds,
    decision: 'skip',
    reason: 'two or more workspaces produce the same DNS-sanitized bucket name',
  }));

  const outcomes = [];
  const created = [];
  const existing = [];
  const configResults = [];

  for (const row of rows) {
    const bucketName = sanitizeBucketName(row.bucket_name);
    if (collidingNames.has(bucketName)) continue; // reported in conflicts, skip

    const outcome = await reconcileBucket(bucketName, seaweedfsClient, { dryRun });
    outcome.workspaceId = row.workspace_id;
    outcome.tenantId = row.tenant_id;
    outcomes.push(outcome);
    if (outcome.action === 'created' || outcome.action === 'would_create') created.push(bucketName);
    else existing.push(bucketName);

    if (row.config && typeof row.config === 'object') {
      const res = await applyBucketConfig(bucketName, row.config, seaweedfsVersion, seaweedfsClient, {
        dryRun,
        matrix,
        gapLogger,
      });
      configResults.push({ bucketName, ...res });
    }
  }

  return { outcomes, conflicts, created, existing, configResults, collisions };
}

/**
 * Verify the reconciliation preconditions: required config fields present and a
 * reachable SeaweedFS endpoint. Throws {@link PrerequisiteError} on failure
 * (before any bucket is created or config written).
 *
 * @param {object} seaweedfsClient
 * @param {{ endpoint?: string, accessKeyId?: string, secretAccessKey?: string }} config
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: true, endpoint: string }>}
 */
export async function checkPrerequisites(seaweedfsClient, config = {}, opts = {}) {
  const { timeoutMs = 5000 } = opts;
  for (const field of ['endpoint', 'accessKeyId', 'secretAccessKey']) {
    const value = config[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new PrerequisiteError(`Missing required storage configuration field: ${field}`, { field });
    }
  }
  if (!seaweedfsClient || typeof seaweedfsClient.listBuckets !== 'function') {
    throw new PrerequisiteError('SeaweedFS client is not configured (no listBuckets capability)', {
      endpoint: config.endpoint,
    });
  }
  try {
    await withTimeout(seaweedfsClient.listBuckets(), timeoutMs, 'SeaweedFS connectivity probe');
  } catch (err) {
    throw new PrerequisiteError(`SeaweedFS endpoint ${config.endpoint} is unreachable: ${err.message}`, {
      endpoint: config.endpoint,
    });
  }
  return { ok: true, endpoint: config.endpoint };
}

/** Default IAM identity name for a workspace's bucket (per-tenant identities = #433). */
export function workspaceIdentity(row) {
  return `falcone-ws-${row.workspace_id}`;
}

/** Build the per-bucket isolation policy granting only the owning workspace identity. */
export function buildIsolationPolicy(bucketName, identity) {
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'OwningWorkspaceOnly',
        Effect: 'Allow',
        Principal: { AWS: [identity] },
        Action: ['s3:*'],
        Resource: [`arn:aws:s3:::${bucketName}`, `arn:aws:s3:::${bucketName}/*`],
      },
    ],
  };
}

/**
 * After buckets are created, apply a bucket policy that restricts access to the
 * owning workspace's IAM identity. The policy principal is run through the G1
 * shim so SeaweedFS accepts it.
 *
 * @param {Array<{ workspace_id: string, bucket_name: string }>} workspaceBuckets
 * @param {object} seaweedfsClient
 * @param {{ dryRun?: boolean, identityFor?: Function }} [opts]
 * @returns {Promise<{ applied: object[] }>}
 */
export async function enforceIsolationPolicies(workspaceBuckets, seaweedfsClient, opts = {}) {
  const { dryRun = false, identityFor = workspaceIdentity } = opts;
  const applied = [];
  for (const row of workspaceBuckets ?? []) {
    const bucketName = sanitizeBucketName(row.bucket_name);
    const identity = identityFor(row);
    const rawPolicy = buildIsolationPolicy(bucketName, identity);
    const { policy } = normalizeSeaweedfsPolicyPrincipal(rawPolicy);
    if (!dryRun) await seaweedfsClient.putBucketPolicy(bucketName, policy);
    applied.push({ bucketName, identity, dryRun });
  }
  return { applied };
}

/**
 * Probe a bucket with a credential scoped to a DIFFERENT tenant and assert the
 * backend denies it with 403. Returns `{ bucketName, isolated: true }` on a 403;
 * throws {@link IsolationViolationError} if access was allowed.
 *
 * @param {string} bucketName
 * @param {object} crossTenantCredential - credential belonging to another tenant
 * @param {object} seaweedfsClient - must accept `headBucket(name, { credential })`
 * @returns {Promise<{ bucketName: string, isolated: true }>}
 */
export async function verifyIsolation(bucketName, crossTenantCredential, seaweedfsClient) {
  try {
    await seaweedfsClient.headBucket(bucketName, { credential: crossTenantCredential });
  } catch (err) {
    const status = err?.statusCode ?? err?.$metadata?.httpStatusCode ?? err?.status;
    if (status === 403 || /403|AccessDenied|Forbidden/i.test(String(err?.code ?? err?.message ?? ''))) {
      return { bucketName, isolated: true };
    }
    throw err; // an unexpected error is not proof of isolation
  }
  throw new IsolationViolationError(bucketName);
}
