/**
 * Shared DNS-sanitization + validation for storage bucket names.
 *
 * Single source of truth for the bucket-name contract used across the SeaweedFS
 * migration: a DNS-safe name matching `[a-z0-9-]` with a length of 3..63
 * characters. The rule is lifted verbatim from the canonical bucket-provision
 * path (`apps/control-plane/storage-handlers.mjs`) so every create/lookup
 * call site validates identically before issuing any backend call.
 *
 * @module utils/bucket-name-validator
 */

/** Lower bound on a DNS-safe bucket name (S3 contract). */
export const BUCKET_NAME_MIN_LENGTH = 3;
/** Upper bound on a DNS-safe bucket name (S3 contract). */
export const BUCKET_NAME_MAX_LENGTH = 63;
/** Canonical pattern: lowercase alphanumerics and hyphens only. */
export const BUCKET_NAME_PATTERN = /^[a-z0-9-]{3,63}$/;

/** Error code raised when a name fails the contract. */
export const INVALID_BUCKET_NAME = 'INVALID_BUCKET_NAME';

/** Typed error thrown by {@link assertValidBucketName}. */
export class InvalidBucketNameError extends Error {
  /**
   * @param {string} name - the offending (stringified) name
   * @param {string} reason - human-readable failure reason
   */
  constructor(name, reason) {
    super(`Invalid bucket name '${name}': ${reason}`);
    this.name = 'InvalidBucketNameError';
    this.code = INVALID_BUCKET_NAME;
    this.bucketName = name;
    this.reason = reason;
  }
}

/**
 * Sanitize an arbitrary string into a DNS-safe bucket-name candidate: lowercase,
 * non `[a-z0-9-]` runs collapsed to a single hyphen, leading/trailing hyphens
 * trimmed, truncated to {@link BUCKET_NAME_MAX_LENGTH}. Mirrors the existing
 * `storage-handlers.mjs` rule. The result may still be shorter than the minimum
 * length — callers decide on a fallback.
 *
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeBucketName(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, BUCKET_NAME_MAX_LENGTH);
}

/**
 * Validate a bucket name against the DNS contract without throwing.
 *
 * @param {string} name
 * @returns {{ valid: boolean, reason: string|null }}
 */
export function validateBucketName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    return { valid: false, reason: 'name must be a non-empty string' };
  }
  if (name.length < BUCKET_NAME_MIN_LENGTH) {
    return { valid: false, reason: `name must be at least ${BUCKET_NAME_MIN_LENGTH} characters` };
  }
  if (name.length > BUCKET_NAME_MAX_LENGTH) {
    return { valid: false, reason: `name must be at most ${BUCKET_NAME_MAX_LENGTH} characters` };
  }
  if (/[A-Z]/.test(name)) {
    return { valid: false, reason: 'name must not contain uppercase letters' };
  }
  if (name.includes('_')) {
    return { valid: false, reason: 'name must not contain underscores' };
  }
  if (!BUCKET_NAME_PATTERN.test(name)) {
    return { valid: false, reason: 'name must match [a-z0-9-]' };
  }
  return { valid: true, reason: null };
}

/**
 * Assert a bucket name is valid, throwing {@link InvalidBucketNameError} otherwise.
 * Use this at every create/lookup call site BEFORE any backend I/O.
 *
 * @param {string} name
 * @returns {string} the validated name (unchanged)
 */
export function assertValidBucketName(name) {
  const { valid, reason } = validateBucketName(name);
  if (!valid) {
    throw new InvalidBucketNameError(name, reason ?? 'invalid');
  }
  return name;
}
