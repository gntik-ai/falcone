// Per-workspace storage capacity quota gate for the kind control-plane (#674).
//
// Storage had NO capacity admission: `storageProvisionBucket` created buckets with
// zero quota check (provisioning past maxBuckets=8 returned all 201), and
// `storageWorkspaceUsage` hardcoded every dimension's limit/remaining/utilizationPercent
// to null, so an operator could never see the effective limit or remaining capacity.
//
// The product ships an engine `packages/adapters/src/storage-capacity-quotas.mjs`
// (error code STORAGE_QUOTA_EXCEEDED, HTTP 409, default bucket limit 8 via
// storage-tenant-context.mjs::DEFAULT_STORAGE_BUCKET_LIMIT). The kind-runtime image,
// however, CANNOT statically import packages/adapters — that engine statically pulls in
// apps/control-plane-executor/src/observability-admin.mjs (the large governance catalog), a
// transitive chain that is fragile to resolve under /repo at runtime (the #660 boot-crash
// pattern; the storage error taxonomy is already duplicated inline in storage-handlers.mjs
// for exactly this reason). So this module INLINES the trivial admission math
// (used + delta > limit) and emits the SAME error code STORAGE_QUOTA_EXCEEDED / HTTP 409 /
// default bucket limit 8 the product engine maps to — matching the inline-duplication
// precedent already in storage-handlers.mjs.
//
// Mirrors the sibling workspace-quota.mjs (#556): an `opts.load` seam makes the effective
// limits injectable for tests, and every helper FAILS OPEN on a loader error — quota is a
// governance control, not a tenant-isolation boundary, so availability wins (a legitimate
// provision is never blocked because the model is unavailable).

// Default per-workspace bucket-count limit. Matches the product engine's
// DEFAULT_STORAGE_BUCKET_LIMIT (packages/adapters/src/storage-tenant-context.mjs:147).
export const DEFAULT_MAX_BUCKETS = 8;

// Canonical error code for a capacity denial (HTTP 409). Mirrors the product engine's
// STORAGE_QUOTA_GUARDRAIL_ERROR_CODES.*.normalizedCode === 'STORAGE_QUOTA_EXCEEDED'.
export const STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED';

// Parse a non-negative-integer env value; returns `fallback` when unset/blank, and `null`
// (never throws) when the value is malformed so the caller can fail open.
function parseLimitEnv(raw, fallback) {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// Default loader: resolve the effective per-workspace limits from the environment.
// `maxBuckets` defaults to DEFAULT_MAX_BUCKETS; `maxBytes` defaults to null (unlimited),
// so the upload hot-path does no usage scan unless an operator opts in via STORAGE_MAX_BYTES.
// A malformed env value collapses that dimension to `null` (treated as unlimited downstream)
// rather than throwing — fail open.
function defaultLoad(env = process.env) {
  return {
    maxBuckets: parseLimitEnv(env.STORAGE_MAX_BUCKETS, DEFAULT_MAX_BUCKETS),
    maxBytes: parseLimitEnv(env.STORAGE_MAX_BYTES, null),
  };
}

// Resolve effective limits via the (injectable) loader, failing open to "unlimited" on any
// loader error so a governance fault never blocks a storage operation.
function resolveLimits(opts = {}) {
  const load = opts.load ?? defaultLoad;
  try {
    const limits = load();
    return {
      maxBuckets: typeof limits?.maxBuckets === 'number' && Number.isFinite(limits.maxBuckets) ? limits.maxBuckets : null,
      maxBytes: typeof limits?.maxBytes === 'number' && Number.isFinite(limits.maxBytes) ? limits.maxBytes : null,
      available: true,
    };
  } catch {
    return { maxBuckets: null, maxBytes: null, available: false }; // loader error → fail open
  }
}

/**
 * Effective per-workspace limits for populating the usage response.
 * @param {object} [opts]
 * @param {()=>{maxBuckets:(number|null),maxBytes:(number|null)}} [opts.load]
 * @returns {{maxBuckets:(number|null), maxBytes:(number|null)}}
 */
export function usageLimits(opts = {}) {
  const { maxBuckets, maxBytes } = resolveLimits(opts);
  return { maxBuckets, maxBytes };
}

/**
 * Decide whether the workspace may provision ANOTHER bucket.
 * @param {number} currentBucketCount   existing bucket count (BEFORE this provision)
 * @param {object} [opts]
 * @param {()=>{maxBuckets:(number|null),maxBytes:(number|null)}} [opts.load]
 * @returns {{allowed:boolean, decision:string, code?:string, limit:(number|null), remaining:(number|null)}}
 */
export function checkBucketQuota(currentBucketCount, opts = {}) {
  const used = Math.max(Number(currentBucketCount) || 0, 0);
  const { maxBuckets, available } = resolveLimits(opts);
  if (!available) return { allowed: true, decision: 'quota_unavailable', limit: null, remaining: null };
  if (maxBuckets == null) return { allowed: true, decision: 'unlimited', limit: null, remaining: null };
  // Provisioning one more would make used+1; deny when that exceeds the limit, i.e. used >= limit.
  if (used + 1 > maxBuckets) {
    return { allowed: false, decision: 'hard_blocked', code: STORAGE_QUOTA_EXCEEDED, limit: maxBuckets, remaining: 0 };
  }
  return { allowed: true, decision: 'within_limit', limit: maxBuckets, remaining: Math.max(maxBuckets - used, 0) };
}

/**
 * Decide whether an upload of `incomingBytes` may proceed given the workspace's current bytes.
 * No-op (always allowed) when no byte limit is configured — the caller skips the usage scan in
 * that case, so this is a defensive second check.
 * @param {number} currentBytes   workspace total stored bytes (BEFORE this upload)
 * @param {number} incomingBytes  size of the object being uploaded
 * @param {object} [opts]
 * @param {()=>{maxBuckets:(number|null),maxBytes:(number|null)}} [opts.load]
 * @returns {{allowed:boolean, decision:string, code?:string, limit:(number|null), remaining:(number|null)}}
 */
export function checkByteQuota(currentBytes, incomingBytes, opts = {}) {
  const used = Math.max(Number(currentBytes) || 0, 0);
  const delta = Math.max(Number(incomingBytes) || 0, 0);
  const { maxBytes, available } = resolveLimits(opts);
  if (!available) return { allowed: true, decision: 'quota_unavailable', limit: null, remaining: null };
  if (maxBytes == null) return { allowed: true, decision: 'unlimited', limit: null, remaining: null };
  if (used + delta > maxBytes) {
    return { allowed: false, decision: 'hard_blocked', code: STORAGE_QUOTA_EXCEEDED, limit: maxBytes, remaining: Math.max(maxBytes - used, 0) };
  }
  return { allowed: true, decision: 'within_limit', limit: maxBytes, remaining: Math.max(maxBytes - used - delta, 0) };
}

/**
 * Build a usage-dimension status from a `used` count and an effective `limit`.
 * `limit == null` denotes "unlimited": remaining/utilizationPercent stay null (so the API
 * reports null only when genuinely unlimited, never perpetually). Otherwise remaining =
 * max(limit - used, 0) and utilizationPercent = round(used / limit * 100) (0 when limit == 0).
 * @param {number} used
 * @param {number|null} limit
 * @returns {{used:number, limit:(number|null), remaining:(number|null), utilizationPercent:(number|null)}}
 */
export function dimensionStatus(used, limit) {
  const u = Math.max(Number(used) || 0, 0);
  if (limit == null || !Number.isFinite(Number(limit))) {
    return { used: u, limit: null, remaining: null, utilizationPercent: null };
  }
  const lim = Math.max(Number(limit), 0);
  const remaining = Math.max(lim - u, 0);
  const utilizationPercent = lim > 0 ? Math.round((u / lim) * 100) : 0;
  return { used: u, limit: lim, remaining, utilizationPercent };
}
