/**
 * S3-compatible storage domain applier for tenant config reprovision.
 * @module appliers/storage-applier
 */

import { compareResources, resolveAction, buildDiff } from '../reprovision/diff.mjs';
import { REDACTED_MARKER, zeroCounts } from '../reprovision/types.mjs';

/**
 * @param {string} tenantId
 * @param {Object} domainData
 * @param {Object} options
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'storage';

  if (!domainData || _isEmpty(domainData)) {
    return { domain_key, status: 'applied', resource_results: [], counts: zeroCounts(), message: 'empty domain' };
  }

  const counts = zeroCounts();
  const resource_results = [];
  let hasWarnings = false;

  const s3Client = credentials.s3Client ?? null;

  const s3Api = credentials.s3Api ?? {
    headBucket: async (name) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.headBucket({ Bucket: name }).promise();
    },
    createBucket: async (name) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.createBucket({ Bucket: name }).promise();
    },
    getBucketVersioning: async (name) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.getBucketVersioning({ Bucket: name }).promise();
    },
    putBucketVersioning: async (name, config) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.putBucketVersioning({ Bucket: name, VersioningConfiguration: config }).promise();
    },
    getBucketLifecycleConfiguration: async (name) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.getBucketLifecycleConfiguration({ Bucket: name }).promise();
    },
    putBucketLifecycleConfiguration: async (name, config) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.putBucketLifecycleConfiguration({ Bucket: name, LifecycleConfiguration: config }).promise();
    },
    getBucketPolicy: async (name) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.getBucketPolicy({ Bucket: name }).promise();
    },
    putBucketPolicy: async (name, policy) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.putBucketPolicy({ Bucket: name, Policy: JSON.stringify(policy) }).promise();
    },
    getBucketCors: async (name) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.getBucketCors({ Bucket: name }).promise();
    },
    putBucketCors: async (name, config) => {
      if (!s3Client) throw new Error('No S3 client configured for reprovision');
      return s3Client.putBucketCors({ Bucket: name, CORSConfiguration: config }).promise();
    },
  };

  const buckets = domainData.buckets;
  if (Array.isArray(buckets)) {
    for (const bucket of buckets) {
      try {
        const result = await _processBucket(bucket, { dryRun, s3Api, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
        if (result.warnings.length > 0) hasWarnings = true;
      } catch (err) {
        resource_results.push({
          resource_type: 'bucket',
          resource_name: bucket.name ?? 'unknown',
          resource_id: null,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        });
        counts.errors++;
      }
    }
  }

  const status = _resolveStatus(counts, dryRun, hasWarnings);
  return { domain_key, status, resource_results, counts, message: null };
}

async function _processBucket(bucket, { dryRun, s3Api, log }) {
  const name = bucket.name ?? 'unknown';
  const warnings = [];
  const cleanedBucket = _stripRedacted(bucket, warnings, name);

  // Check if bucket exists
  let exists = false;
  try {
    await s3Api.headBucket(name);
    exists = true;
  } catch { /* bucket doesn't exist */ }

  if (!exists) {
    const action = dryRun ? 'would_create' : 'created';
    if (!dryRun) {
      await s3Api.createBucket(name);
      // Apply versioning if specified
      if (cleanedBucket.versioning) {
        await s3Api.putBucketVersioning(name, cleanedBucket.versioning);
      }
      // Apply lifecycle if specified
      if (cleanedBucket.lifecycle) {
        await s3Api.putBucketLifecycleConfiguration(name, cleanedBucket.lifecycle);
      }
      // Apply policy if specified
      if (cleanedBucket.policy) {
        await s3Api.putBucketPolicy(name, cleanedBucket.policy);
      }
      // Apply CORS if specified
      if (cleanedBucket.cors) {
        await s3Api.putBucketCors(name, cleanedBucket.cors);
      }
    }
    const finalAction = warnings.length > 0 ? (dryRun ? 'would_create' : 'applied_with_warnings') : action;
    return { resource_type: 'bucket', resource_name: name, resource_id: null, action: finalAction, message: null, warnings, diff: null };
  }

  // Bucket exists — compare configuration
  const existingConfig = {};
  const desiredConfig = {};

  try {
    existingConfig.versioning = await s3Api.getBucketVersioning(name);
  } catch { existingConfig.versioning = null; }

  try {
    existingConfig.lifecycle = await s3Api.getBucketLifecycleConfiguration(name);
  } catch { existingConfig.lifecycle = null; }

  try {
    const policyStr = await s3Api.getBucketPolicy(name);
    existingConfig.policy = typeof policyStr === 'string' ? JSON.parse(policyStr) : (policyStr?.Policy ? JSON.parse(policyStr.Policy) : policyStr);
  } catch { existingConfig.policy = null; }

  try {
    existingConfig.cors = await s3Api.getBucketCors(name);
  } catch { existingConfig.cors = null; }

  desiredConfig.versioning = cleanedBucket.versioning ?? null;
  desiredConfig.lifecycle = cleanedBucket.lifecycle ?? null;
  desiredConfig.policy = cleanedBucket.policy ?? null;
  desiredConfig.cors = cleanedBucket.cors ?? null;

  const comparison = compareResources(
    _normalizeForCompare(existingConfig),
    _normalizeForCompare(desiredConfig),
    []
  );

  const action = resolveAction(true, comparison, dryRun);
  const diff = (action === 'conflict' || action === 'would_conflict') ? buildDiff(existingConfig, desiredConfig) : null;

  return { resource_type: 'bucket', resource_name: name, resource_id: null, action, message: null, warnings, diff };
}

function _normalizeForCompare(config) {
  // Normalize JSON for comparison — remove whitespace differences
  return JSON.parse(JSON.stringify(config));
}

function _stripRedacted(item, warnings, resourceName) {
  const clone = structuredClone(item);
  _walk(clone, [], warnings, resourceName);
  return clone;
}

function _walk(obj, path, warnings, resourceName) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, val] of Object.entries(obj)) {
    if (val === REDACTED_MARKER) {
      delete obj[key];
      warnings.push(`Redacted field '${[...path, key].join('.')}' omitted for resource '${resourceName}'`);
    } else if (typeof val === 'object' && val !== null) {
      _walk(val, [...path, key], warnings, resourceName);
    }
  }
}

function _isEmpty(domainData) {
  return !Array.isArray(domainData.buckets) || domainData.buckets.length === 0;
}

function _updateCounts(counts, action) {
  if (action === 'created' || action === 'would_create' || action === 'applied_with_warnings') counts.created++;
  else if (action === 'skipped' || action === 'would_skip') counts.skipped++;
  else if (action === 'conflict' || action === 'would_conflict') counts.conflicts++;
  else if (action === 'error') counts.errors++;
}

function _resolveStatus(counts, dryRun, hasWarnings) {
  if (counts.errors > 0 && counts.created === 0 && counts.skipped === 0 && counts.conflicts === 0) return 'error';
  if (counts.conflicts > 0 && counts.created === 0) return dryRun ? 'would_conflict' : 'conflict';
  if (hasWarnings) return dryRun ? 'would_apply_with_warnings' : 'applied_with_warnings';
  if (counts.created > 0) return dryRun ? 'would_apply' : 'applied';
  return dryRun ? 'would_skip' : 'skipped';
}
